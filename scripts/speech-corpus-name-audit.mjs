#!/usr/bin/env node
// scripts/speech-corpus-name-audit.mjs
//
// Static corpus scan for the ai-speech-name-detection-harness card (H1).
//
// Scans every src/data/*_speeches.json pool and counts, per pool:
//   - Agent[XX] references (raw AIWolf-contest entities)
//   - known AIWolf personal names (JA romanized + katakana + EN; the shared
//     list lives in src/diagnostics/aiwolf-entities.json)
//   - out-of-range seat references (seats outside 1..12 — no board seats more
//     than 12 players; per-board violations such as 10号 in a 9p game are
//     runtime facts covered by the vitest audit, not this static scan)
//
// Plain Node, zero dependencies, zero network. Exits non-zero when any
// violation exists (it does today — this quantifies the template pollution).
//
// Usage: node scripts/speech-corpus-name-audit.mjs

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(REPO_ROOT, 'src/data');
const ENTITIES_PATH = join(REPO_ROOT, 'src/diagnostics/aiwolf-entities.json');

const { latinNames, katakanaNames } = JSON.parse(readFileSync(ENTITIES_PATH, 'utf8'));

const AGENT_RE = /Agent\s*\[\s*\d+\s*\]/g;
const MAX_BOARD_SEAT = 12;

const latinRes = latinNames.map((name) => ({
  name,
  re: new RegExp(`(?<![A-Za-z])${name}(?![a-z])`, 'g'),
}));
const katakanaRes = katakanaNames.map((name) => ({
  name,
  re: new RegExp(`(?<![ァ-ヶー])${name}(?![ァ-ヶー])`, 'g'),
}));

const seatRefs = (text) => {
  const refs = [];
  for (const m of text.matchAll(/(\d{1,2})\s*号/g)) refs.push(Number(m[1]));
  for (const m of text.matchAll(/player\s*(\d{1,2})/gi)) refs.push(Number(m[1]));
  for (const m of text.matchAll(/Agent\s*\[\s*(\d{1,2})\s*\]/g)) refs.push(Number(m[1]));
  return refs;
};

const pools = readdirSync(DATA_DIR)
  .filter((f) => f.endsWith('_speeches.json'))
  .sort();

let grandTotal = 0;
const rows = [];

for (const file of pools) {
  const entries = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
  let agentRefs = 0;
  let agentEntries = 0;
  let nameRefs = 0;
  let nameEntries = 0;
  let badSeatRefs = 0;
  let badSeatEntries = 0;
  const nameCounts = new Map();

  for (const entry of entries) {
    const text = entry.text || '';

    const agents = text.match(AGENT_RE);
    if (agents) {
      agentEntries += 1;
      agentRefs += agents.length;
    }

    let entryNames = 0;
    for (const { name, re } of [...latinRes, ...katakanaRes]) {
      const matches = text.match(re);
      if (matches) {
        entryNames += matches.length;
        nameCounts.set(name, (nameCounts.get(name) || 0) + matches.length);
      }
    }
    if (entryNames > 0) {
      nameEntries += 1;
      nameRefs += entryNames;
    }

    const bad = seatRefs(text).filter((n) => n < 1 || n > MAX_BOARD_SEAT);
    if (bad.length > 0) {
      badSeatEntries += 1;
      badSeatRefs += bad.length;
    }
  }

  const poolViolations = agentRefs + nameRefs + badSeatRefs;
  grandTotal += poolViolations;
  const topNames = [...nameCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([n, c]) => `${n}:${c}`)
    .join(' ');

  rows.push({ file, entries: entries.length, agentEntries, agentRefs, nameEntries, nameRefs, badSeatEntries, badSeatRefs, poolViolations, topNames });
}

console.log('Speech-corpus name audit (H1) — per-pool violation counts');
console.log('pool                       entries  agentEnt  agentRef  nameEnt  nameRef  badSeatEnt  badSeatRef  total');
for (const r of rows) {
  console.log(
    `${r.file.padEnd(26)} ${String(r.entries).padStart(7)} ${String(r.agentEntries).padStart(9)} ` +
    `${String(r.agentRefs).padStart(9)} ${String(r.nameEntries).padStart(8)} ${String(r.nameRefs).padStart(8)} ` +
    `${String(r.badSeatEntries).padStart(11)} ${String(r.badSeatRefs).padStart(11)} ${String(r.poolViolations).padStart(6)}`,
  );
  console.log(`  top names: ${r.topNames || '(none)'}`);
}
console.log(`TOTAL violations: ${grandTotal}`);

if (grandTotal > 0) {
  console.error('FAIL: corpus contains out-of-roster entities (see counts above).');
  process.exitCode = 1;
} else {
  console.log('PASS: no out-of-roster entities found in the corpus.');
}
