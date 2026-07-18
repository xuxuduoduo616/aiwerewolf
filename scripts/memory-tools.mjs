#!/usr/bin/env node
// Memory governance tools for the aiwerewolf shared memory tree.
// Usage: node scripts/memory-tools.mjs <audit|validate|status|update>
// Reports problems only — never deletes or rewrites memory files.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CANONICAL = {
  'memory/INDEX.md': 'navigation',
  'memory/MEMORY_CONTRACT.md': 'contract',
  'memory/product-brief.md': 'product goals',
  'memory/project-overview.md': 'architecture',
  'memory/progress-report.md': 'roadmap',
  'memory/coordination/PROJECT_STATE.md': 'current state',
  'memory/coordination/WORKFLOW.md': 'workflow',
  'memory/coordination/TASK_TEMPLATE.md': 'task template',
};
const ENTRIES = ['CLAUDE.md', 'AGENTS.md'];
const STATE_MARKERS = [/Last verified:/i, /\*\*Project phase:/i];
const SECRET_RE = /(sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|re_[A-Za-z0-9]{20,})/;

const read = p => readFileSync(join(ROOT, p), 'utf8');
const rel = p => p.replace(ROOT + '/', '');
let problems = 0;
const bad = msg => { problems += 1; console.log(`  ✗ ${msg}`); };
const ok = msg => console.log(`  ✓ ${msg}`);

const mdFiles = dir => {
  const out = [];
  const walk = d => {
    for (const e of readdirSync(join(ROOT, d))) {
      const p = join(d, e);
      const st = statSync(join(ROOT, p));
      if (st.isDirectory()) { if (!/runs$/.test(p)) walk(p); }
      else if (e.endsWith('.md')) out.push(p);
    }
  };
  walk(dir);
  return out;
};

// Extract repo-relative markdown link targets, ignoring http/anchors.
const linkTargets = (src, text) =>
  [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)]
    .map(m => m[1])
    .filter(t => !/^https?:|^mailto:/.test(t))
    .map(t => t.startsWith('/') ? t.slice(1) : join(dirname(src), t));

function validate() {
  console.log('memory validate');
  for (const f of [...Object.keys(CANONICAL), ...ENTRIES]) {
    existsSync(join(ROOT, f)) ? ok(`${f} exists`) : bad(`${f} MISSING`);
  }
  for (const e of ENTRIES) {
    if (!existsSync(join(ROOT, e))) continue;
    const t = read(e);
    /memory\/INDEX\.md/.test(t) ? ok(`${e} reaches memory/INDEX.md`) : bad(`${e} does not reference memory/INDEX.md`);
    new RegExp(`@${e}\\b`).test(t) ? bad(`${e} imports itself`) : ok(`${e} no self-import`);
    /\/Users\//.test(t) && bad(`${e} contains absolute /Users/ path`);
  }
  // exactly one file owns current state
  const owners = mdFiles('memory').filter(f => {
    if (/coordination\/(tasks|reports|handoffs)\//.test(f) || /decisions\//.test(f)) return false;
    const t = read(f);
    return STATE_MARKERS.every(re => re.test(t));
  });
  owners.length === 1 && owners[0] === 'memory/coordination/PROJECT_STATE.md'
    ? ok('current-state ownership unique (PROJECT_STATE.md)')
    : bad(`current-state markers found in: ${owners.join(', ') || 'none'}`);
  // broken links in canonical + entries
  for (const f of [...Object.keys(CANONICAL), ...ENTRIES]) {
    if (!existsSync(join(ROOT, f))) continue;
    for (const t of linkTargets(f, read(f))) {
      if (!existsSync(join(ROOT, t))) bad(`${f} → broken link: ${t}`);
    }
  }
  // pending deltas must not claim Accepted
  if (existsSync(join(ROOT, 'memory/coordination/handoffs'))) {
    for (const f of mdFiles('memory/coordination/handoffs')) {
      /Status:\s*Accepted/i.test(read(f)) && bad(`${f} pending delta marked Accepted`);
    }
  }
  return summary('validate');
}

function audit() {
  console.log('memory audit');
  // stale state facts outside PROJECT_STATE
  const stateRe = /(\d+)\/\1 tests|\d+ passed \/ \d+ skipped|tests? (通过|passed)/i;
  for (const f of mdFiles('memory')) {
    if (/coordination\/(tasks|reports|handoffs)\//.test(f) || f === 'memory/coordination/PROJECT_STATE.md' || /decisions\//.test(f)) continue;
    stateRe.test(read(f)) && bad(`${f} carries test-baseline facts (owner: PROJECT_STATE.md)`);
  }
  // secrets scan (canonical + entries + handoffs)
  const scan = [...Object.keys(CANONICAL), ...ENTRIES,
    ...(existsSync(join(ROOT, 'memory/coordination/handoffs')) ? mdFiles('memory/coordination/handoffs') : [])];
  for (const f of scan) {
    if (existsSync(join(ROOT, f)) && SECRET_RE.test(read(f))) bad(`${f} may contain a secret`);
  }
  // broken links across all memory md (excluding runs)
  for (const f of mdFiles('memory')) {
    if (/coordination\/(reports|tasks)\//.test(f)) continue; // historical evidence tolerated
    for (const t of linkTargets(f, read(f))) {
      if (!existsSync(join(ROOT, t))) bad(`${f} → broken link: ${t}`);
    }
  }
  // duplicate workflow-rule copies (rough heuristic)
  const ruleRe = /maximum of\s+10 workers|最多 ?10 个|max(imum)? 10 (concurrent )?workers/i;
  const dupes = ['CLAUDE.md', 'AGENTS.md', 'memory/coordination/WORKFLOW.md'].filter(f => existsSync(join(ROOT, f)) && ruleRe.test(read(f)));
  dupes.length > 1 ? bad(`worker-cap rule duplicated in: ${dupes.join(', ')}`) : ok('worker-cap rule single-sourced');
  problems === 0 && ok('no duplicate facts / stale state / secrets found');
  return summary('audit');
}

function status() {
  const sh = c => execSync(c, { cwd: ROOT, encoding: 'utf8' }).trim();
  const state = read('memory/coordination/PROJECT_STATE.md');
  const grab = re => (state.match(re) || [, '?'])[1];
  console.log('memory status');
  console.log(`  HEAD:          ${sh('git log --oneline -1')}`);
  console.log(`  origin/main:   ${sh('git log --oneline -1 origin/main 2>/dev/null || echo n/a')}`);
  console.log(`  Last verified: ${grab(/Last verified:\*?\*?\s*([0-9-]+)/)}`);
  console.log(`  Phase:         ${grab(/Project phase:\*?\*?\s*([^\n]+)/).slice(0, 100)}`);
  const tasks = readdirSync(join(ROOT, 'memory/coordination/tasks')).filter(f => f.endsWith('.md'));
  let queued = 0, review = 0;
  for (const f of tasks) {
    const t = read(join('memory/coordination/tasks', f));
    if (/## Status\s+Queued/.test(t)) queued++;
    if (/## Status\s+Ready for review/.test(t)) review++;
  }
  console.log(`  Tasks:         ${tasks.length} cards (${queued} queued, ${review} in review)`);
  const hand = existsSync(join(ROOT, 'memory/coordination/handoffs'))
    ? readdirSync(join(ROOT, 'memory/coordination/handoffs')).filter(f => f.endsWith('.md')).length : 0;
  console.log(`  Pending deltas: ${hand}`);
}

function update() {
  const base = execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  console.log(`# Memory Delta — fill verified facts only; do not fabricate.
Metadata: timestamp=<UTC> agent=<name> role=<coordinator|coder|debugger|unknown> task_id=<id|-> base_commit=${base} evidence_paths=<paths>
Changed: <verified change>
Decisions: <confirmed decision + why, or ->
Evidence: <test/build/browser/deploy/report refs>
Blockers: <new/resolved, or ->
Next: <next actionable step>
Canonical targets: <which canonical file each item updates>

Save to memory/coordination/handoffs/<UTC>-<agent>.md if you are not the coordinator.`);
}

function summary(name) {
  console.log(problems === 0 ? `${name}: PASS` : `${name}: ${problems} problem(s)`);
  return problems === 0 ? 0 : 1;
}

const cmd = process.argv[2];
if (cmd === 'validate') process.exit(validate());
else if (cmd === 'audit') process.exit(audit());
else if (cmd === 'status') status();
else if (cmd === 'update') update();
else { console.error('usage: memory-tools.mjs <audit|validate|status|update>'); process.exit(2); }
