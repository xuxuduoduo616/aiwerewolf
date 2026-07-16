# Task: provider-adapter-dry-run

## Status

Queued

## Objective

Create a local verification script `scripts/provider-dry-run.mjs` that exercises the provider-adapter handler in-process (no deployment): dry-run every registry entry, optionally run a live minimal probe of provider MODELS endpoints only (gated behind `LIVE_PROBE=true`), with redacted logging, writing a markdown result report — plus tests for the report formatting.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `netlify/functions/provider-adapter.js` (the handler under verification — from card `provider-adapter-refactor`; import read-only)
- `netlify/__tests__/provider-adapter.test.js` (how the handler is invoked with a synthetic event)
- `memory/coordination/reports/provider-discovery-initial.md` (known provider endpoints and auth behavior)

## Context

- **Parallel wave: Wave 2**. Dependencies: `provider-adapter-refactor` (must be Accepted first). Coordinator note: do NOT run concurrently with `model-routing-cost-guard` unless integration order is managed — this card imports `provider-adapter.js` read-only while that card edits it; sequential integration is safer.
- **Dry-run mode (default)**: for every PROVIDER_REGISTRY entry, invoke the handler in-process with `ADAPTER_DRY_RUN=true` and a synthetic Netlify event; record per-entry status. Zero network by default.
- **Live probe mode (optional)**: ONLY when the explicit env flag `LIVE_PROBE=true` is set. It calls provider MODELS/listing endpoints only — NEVER completion/messages endpoints (no token spend). Missing env keys → mark entry `skipped (no key)`, never fail. All logging redacted: no key material or auth header values may appear in stdout or the report; show at most an env-var NAME and whether it is set.
- **Output**: writes a markdown report to `memory/coordination/reports/provider-adapter-dry-run-results.md` (this results file is an allowed output path). Report includes: date, mode (dry-run/live-probe), per-entry table (provider, protocol, dry-run result, probe result or skipped-reason), and open issues.
- **Tests**: unit-test the report FORMATTING (pure function: results array → markdown string) — no live calls in tests, no filesystem dependence in the formatting function. Place the test following repo conventions (e.g. `scripts/provider-dry-run.test.mjs` or a colocated test the vitest config picks up — check `vitest` include patterns first).
- No secrets in the script, the report, or this card. Keys come from env at runtime only.
- Scope boundary: script + its test + the results report path. Do not modify the provider-adapter function itself.

## Allowed changes

- `scripts/provider-dry-run.mjs` — new
- Test file for the script's report formatting
- `memory/coordination/reports/provider-adapter-dry-run-results.md` — script output

## Do not change

- `netlify/functions/**` (import read-only), frontend files, other scripts.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. `node scripts/provider-dry-run.mjs` runs the handler in-process for every registry entry under `ADAPTER_DRY_RUN=true` with zero network activity and writes the markdown results report.
2. Live probe runs ONLY with `LIVE_PROBE=true`, hits models/listing endpoints only (never completions), and marks entries with missing keys as skipped rather than failing.
3. No key material or auth header value ever appears in stdout or the report (redaction verified by test on the formatter and by inspection of the probe code path).
4. Report formatting is a pure, unit-tested function.
5. `npm run test:run` and `npm run build` pass with zero regressions.

## Verification

```bash
npm run test:run
npm run build
node scripts/provider-dry-run.mjs
```

## Handoff

- Report path: `memory/coordination/reports/provider-adapter-dry-run.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
