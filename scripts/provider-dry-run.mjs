// scripts/provider-dry-run.mjs
//
// Local verification for netlify/functions/provider-adapter.js.
//
// Default mode (zero network): loads the adapter in-process (same vm pattern
// as netlify/__tests__/provider-adapter.test.js), sets ADAPTER_DRY_RUN=true,
// invokes exports.handler with a synthetic Netlify event for every
// PROVIDER_REGISTRY entry, and verifies the response contract. `fetch` and
// `require` inside the adapter are replaced with guards that record any
// attempted network/SDK access, so "zero network" is proven, not assumed.
//
// Optional live probe (LIVE_PROBE=true only): GETs each provider's read-only
// models/listing endpoint — NEVER a completion/messages endpoint. Missing env
// keys mark the entry "skipped (no key)". Logging is redacted: only provider
// name, model, HTTP status code, and error class are ever printed; no key
// material or auth header value appears in stdout or the report.
//
// Output: memory/coordination/reports/provider-adapter-dry-run-results.md
//
// Usage:
//   node scripts/provider-dry-run.mjs                 # offline dry-run
//   LIVE_PROBE=true node scripts/provider-dry-run.mjs # + models-endpoint probe

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const ADAPTER_PATH = join(REPO_ROOT, 'netlify/functions/provider-adapter.js');
const REPORT_PATH = join(REPO_ROOT, 'memory/coordination/reports/provider-adapter-dry-run-results.md');
const PROBE_TIMEOUT_MS = 10_000;

// --- Redaction (kept dependency-free so the formatter stays pure) ------------
// Mirrors the adapter's own redaction patterns: strip Bearer tokens and any
// authorization / x-api-key header values from free-form detail strings.
const BEARER_RE = /Bearer\s+[^\s'",;|]+/gi;
const SENSITIVE_HEADER_RE = /((?:authorization|x-api-key)['"]?\s*[:=]\s*)['"]?[^\s'",;|]+/gi;

export const redactForReport = (value) => {
  let text = typeof value === 'string' ? value : String(value);
  text = text.replace(BEARER_RE, 'Bearer [REDACTED]');
  text = text.replace(SENSITIVE_HEADER_RE, '$1[REDACTED]');
  return text;
};

// --- Report formatting (pure: results + meta in, markdown out) ---------------
// results: [{ provider, protocol, model, dryRun: { ok, detail },
//             probe: { status: 'ok'|'skipped'|'failed', detail } }]
// meta: { date, mode, networkViolations: string[] }
export const formatReport = (results, meta) => {
  const cell = (value) => redactForReport(value).replace(/\|/g, '\\|');
  const lines = [
    '# Provider Adapter Dry-Run Results',
    '',
    `- Date: ${meta.date}`,
    `- Mode: ${meta.mode}`,
    `- Network/SDK access attempts during dry-run phase: ${meta.networkViolations.length}`,
    '',
    '| Provider | Protocol | Model | Dry-run | Live probe |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const entry of results) {
    const dryRun = `${entry.dryRun.ok ? 'PASS' : 'FAIL'} — ${cell(entry.dryRun.detail)}`;
    const probe = `${entry.probe.status} — ${cell(entry.probe.detail)}`;
    lines.push(`| ${cell(entry.provider)} | ${cell(entry.protocol)} | ${cell(entry.model)} | ${dryRun} | ${probe} |`);
  }
  lines.push('', '## Open issues', '');
  const issues = [];
  for (const entry of results) {
    if (!entry.dryRun.ok) issues.push(`- ${cell(entry.provider)}: dry-run FAIL — ${cell(entry.dryRun.detail)}`);
    if (entry.probe.status === 'failed') issues.push(`- ${cell(entry.provider)}: probe failed — ${cell(entry.probe.detail)}`);
  }
  for (const violation of meta.networkViolations) {
    issues.push(`- dry-run guard violation: ${cell(violation)}`);
  }
  lines.push(...(issues.length ? issues : ['- none']));
  lines.push('');
  return lines.join('\n');
};

// --- In-process adapter loader (same vm pattern as the adapter's unit test) --
// fetch/require are guards: in dry-run mode the adapter must never reach them.
const loadAdapter = (violations) => {
  const guardedFetch = (url) => {
    violations.push(`fetch(${redactForReport(String(url))})`);
    return Promise.reject(new Error('network-blocked-by-dry-run-guard'));
  };
  const guardedRequire = (id) => {
    violations.push(`require(${id})`);
    throw new Error('require-blocked-by-dry-run-guard');
  };
  const module = { exports: {} };
  const context = vm.createContext({
    console,
    Date,
    Map,
    JSON,
    process,
    setTimeout,
    clearTimeout,
    Promise,
    Infinity,
    Math,
    Number,
    AbortController,
    fetch: guardedFetch,
    require: guardedRequire,
    exports: module.exports,
    module,
  });
  const script = new vm.Script(readFileSync(ADAPTER_PATH, 'utf8'), { filename: ADAPTER_PATH });
  script.runInContext(context);
  return module.exports;
};

// --- Dry-run: contract check per registry entry -------------------------------
const checkContract = (provider, response, costCeiling) => {
  const problems = [];
  if (response.statusCode !== 200) problems.push(`statusCode=${response.statusCode} (expected 200)`);
  let body;
  try {
    body = JSON.parse(response.body);
  } catch {
    return { ok: false, detail: 'body is not valid JSON' };
  }
  if (typeof body.text !== 'string' || body.text.length === 0) problems.push('text missing/empty');
  if (body.model_used !== provider) problems.push(`model_used=${body.model_used} (expected ${provider})`);
  if (typeof body.cost_estimate !== 'number' || body.cost_estimate < 0) problems.push('cost_estimate not a non-negative number');
  else if (body.cost_estimate > costCeiling) problems.push(`cost_estimate ${body.cost_estimate} exceeds ceiling ${costCeiling}`);
  if (body.fallback_used !== false) problems.push(`fallback_used=${body.fallback_used} (expected false)`);
  // Budget fields are optional in the current contract; validate type if present.
  for (const field of ['budget_remaining', 'budget_used']) {
    if (field in body && typeof body[field] !== 'number') problems.push(`${field} present but not a number`);
  }
  if (problems.length) return { ok: false, detail: problems.join('; ') };
  return { ok: true, detail: `model_used=${body.model_used}, cost_estimate=${body.cost_estimate}, fallback_used=${body.fallback_used}` };
};

const runDryRun = async (adapter) => {
  const results = [];
  for (const [provider, cfg] of Object.entries(adapter.PROVIDER_REGISTRY)) {
    const event = {
      httpMethod: 'POST',
      headers: { origin: 'http://localhost:5173' },
      body: JSON.stringify({ prompt: 'dry-run contract check', provider }),
    };
    let dryRun;
    try {
      const response = await adapter.handler(event);
      dryRun = checkContract(provider, response, adapter.COST_CEILING_PER_CALL);
    } catch (err) {
      dryRun = { ok: false, detail: `handler threw: ${redactForReport((err && err.message) || err)}` };
    }
    results.push({ provider, protocol: cfg.protocol, model: cfg.model, dryRun });
  }
  return results;
};

// --- Optional live probe (read-only models/listing endpoints ONLY) -----------
const MODELS_PATH_BY_PROTOCOL = {
  'anthropic-messages': '/v1/models',
  'openai-chat': '/models',
};

const classifyStatus = (status) => {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  return 'http-error';
};

const probeEntry = async (provider, cfg) => {
  if (cfg.protocol === 'local') return { status: 'skipped', detail: 'local provider, no endpoint' };
  if (!cfg.baseUrl) return { status: 'skipped', detail: 'SDK-managed endpoint, no REST models URL' };
  const modelsPath = MODELS_PATH_BY_PROTOCOL[cfg.protocol];
  if (!modelsPath) return { status: 'skipped', detail: `no models endpoint mapping for protocol ${cfg.protocol}` };

  const envNames = cfg.apiKeyEnv || [];
  const setEnvName = envNames.find((name) => process.env[name]);
  if (!setEnvName) return { status: 'skipped', detail: `no key (${envNames.join(', ') || 'no env configured'} not set)` };

  const apiKey = process.env[setEnvName];
  const headers =
    cfg.authHeader === 'authorization-bearer'
      ? { Authorization: `Bearer ${apiKey}` }
      : { 'x-api-key': apiKey };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // GET models listing only — never a completion/messages endpoint.
    const res = await fetch(`${cfg.baseUrl}${modelsPath}`, { method: 'GET', headers, signal: controller.signal });
    if (res.ok) return { status: 'ok', detail: `HTTP ${res.status} (key: ${setEnvName})` };
    return { status: 'failed', detail: `HTTP ${res.status} (${classifyStatus(res.status)}, key: ${setEnvName})` };
  } catch (err) {
    const kind = err && err.name === 'AbortError' ? 'timeout' : 'network';
    return { status: 'failed', detail: `error class: ${kind}` };
  } finally {
    clearTimeout(timer);
  }
};

// --- Main ---------------------------------------------------------------------
const main = async () => {
  const liveProbe = process.env.LIVE_PROBE === 'true';
  const violations = [];
  const adapter = loadAdapter(violations);

  const previousDryRun = process.env.ADAPTER_DRY_RUN;
  process.env.ADAPTER_DRY_RUN = 'true';
  let results;
  try {
    results = await runDryRun(adapter);
  } finally {
    if (previousDryRun === undefined) delete process.env.ADAPTER_DRY_RUN;
    else process.env.ADAPTER_DRY_RUN = previousDryRun;
  }

  for (const entry of results) {
    entry.probe = liveProbe
      ? await probeEntry(entry.provider, adapter.PROVIDER_REGISTRY[entry.provider])
      : { status: 'skipped', detail: 'LIVE_PROBE not set' };
  }

  const meta = {
    date: new Date().toISOString(),
    mode: liveProbe ? 'dry-run + live-probe (models endpoints only)' : 'dry-run only (zero network)',
    networkViolations: violations,
  };
  const markdown = formatReport(results, meta);
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, markdown, 'utf8');

  for (const entry of results) {
    console.log(
      redactForReport(
        `${entry.dryRun.ok ? 'PASS' : 'FAIL'} ${entry.provider} [${entry.protocol}] dry-run: ${entry.dryRun.detail} | probe: ${entry.probe.status} — ${entry.probe.detail}`
      )
    );
  }
  console.log(`Report written: ${REPORT_PATH}`);

  const failed = results.filter((entry) => !entry.dryRun.ok);
  if (failed.length || violations.length) {
    console.error(`Dry-run failures: ${failed.length}, guard violations: ${violations.length}`);
    process.exitCode = 1;
  }
};

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(redactForReport(`provider-dry-run failed: ${(err && err.message) || err}`));
    process.exitCode = 1;
  });
}
