# Debugger Review: provider-adapter-dry-run

**Date:** 2026-07-16
**Reviewer:** DEBUGGER (independent verification)
**Patch:** `memory/coordination/runs/provider-adapter-dry-run-claude.patch`
**Worktree:** `.claude/worktrees/agent-adce7e1a797dc7251` (base `b7a8529`)

## 1. Patch scope

`git apply --numstat`: exactly three files, all additions (377 insertions, 0 deletions):

- `scripts/provider-dry-run.mjs` (257)
- `scripts/provider-dry-run.test.mjs` (103)
- `memory/coordination/reports/provider-adapter-dry-run-results.md` (17)

The patch does NOT touch `netlify/functions/provider-adapter.js`. The only two
`netlify/functions` occurrences in the patch are a comment and the `ADAPTER_PATH`
string inside the new script (read-only import path), not diff hunks. Scope: OK.

## 2. Patch check against current main

`git apply --check` at main HEAD `a6b14ab` — applies cleanly (check only; not applied). OK.

## 3. Reproduction in the worktree

- `npm run test:run` — **70/70 passed, 10 test files** (matches coder report; includes
  the 8 new formatter/redaction tests and the 15 provider-adapter tests from the
  locally-applied refactor dependency). Zero failures.
- `npm run build` — TypeScript + Vite production build succeeded.
- `node scripts/provider-dry-run.mjs` — **exit 0**; all 5 registry entries PASS
  (gemini-2.5-flash, aicodemirror-claude, deepseek-anthropic, deepseek-openai,
  local-fallback); results report written with
  "Network/SDK access attempts during dry-run phase: 0" and "Open issues: none".
- `LIVE_PROBE=true` with all provider keys explicitly unset
  (`env -u DEEPSEEK_API_KEY -u AICODEMIRROR_API_KEY -u API_KEY -u GEMINI_API_KEY`) —
  exit 0; every probe `skipped` with a reason (SDK-managed / no key `<ENV_NAME>` not
  set / local). Missing key = skip, never fail. Confirmed empirically.
- The staged results report was restored after my re-runs; worktree left as the coder staged it.

## 4. Zero-network proof

Verified by reading `scripts/provider-dry-run.mjs`:

- The adapter is loaded in a `vm` context (same pattern as
  `netlify/__tests__/provider-adapter.test.js`) where `fetch` and `require` are
  replaced by real throwing guards (`network-blocked-by-dry-run-guard`,
  `require-blocked-by-dry-run-guard`) that also push into a `violations` array
  surfaced in the report and force exit code 1. Not a comment — an enforced stub.
- In default mode `probeEntry` is never invoked (`entry.probe` is set to
  `skipped — LIVE_PROBE not set` without any call), so the host `fetch` used by the
  probe path is unreachable without `LIVE_PROBE=true`.
- `ADAPTER_DRY_RUN` is set for the run and the previous value restored in `finally`.

## 5. Live-probe gating and redaction

- Gate: `process.env.LIVE_PROBE === 'true'` only.
- Endpoints: single `fetch` call in the probe path, `GET {baseUrl}` +
  `MODELS_PATH_BY_PROTOCOL` (`/v1/models` for anthropic-messages, `/models` for
  openai-chat). No completion/messages/chat endpoint appears anywhere in the script.
  `local` and SDK-managed (`baseUrl: null`, i.e. gemini) entries are skipped; unknown
  protocols are skipped, not failed.
- Missing key → `skipped (no key (<ENV_NAME> not set))`; only the env-var NAME is
  shown, never a value. Keys go into request headers only, never URLs or output.
- Output redaction: probe details contain only HTTP status + error class
  (auth/rate-limit/server/timeout/network) + env-var name; all console lines and
  every report cell pass through `redactForReport` (Bearer + authorization/x-api-key
  patterns), which is unit-tested.
- Probe failures are recorded as open issues but do not fail the exit code; only
  dry-run contract failures and guard violations do. Consistent with the card
  (criterion 2 requires skip-not-fail for missing keys only).

## 6. Formatter test

`scripts/provider-dry-run.test.mjs`: 8 tests against the pure exported
`formatReport(results, meta)` and `redactForReport` — no fs, no network, no Date
access inside the formatter (date passed via `meta`). Covers table rendering,
open-issues aggregation, guard-violation listing, Bearer/x-api-key redaction, pipe
escaping, and determinism. Picked up by vitest default include (ran in the 70-test suite).

## 7. Main-compatibility check (budget guard)

Main HEAD `a6b14ab` ("feat(adapter): daily budget guard + per-provider counters")
adds `budget_remaining` to the dry-run response and a 402 budget-exhausted path
that precedes the dry-run branch — the worktree's adapter copy predates this.

- The script's `checkContract` treats `budget_remaining` / `budget_used` as
  OPTIONAL numeric fields ("if present, must be a number"), so main's added field
  passes; no exact-field-set assertion exists.
- Empirical check: I temporarily swapped MAIN's current `provider-adapter.js` into
  the worktree, ran `node scripts/provider-dry-run.mjs` — exit 0, all 5 entries
  PASS with `budget_remaining` present; then restored the worktree file
  (diff-verified byte-identical to the coder's version).
- 402 budget path: the budget accumulator is module-level and fresh per script
  process (default $1/day), and dry-run mode does not record spend, so a fresh run
  cannot hit the 402 path. It could trigger only if `ADAPTER_DAILY_BUDGET_USD` is
  set to a tiny positive value in the environment — in which case the script would
  correctly FAIL the entry (statusCode 402, fallback_used=true), surfacing a real
  config problem rather than asserting a stale contract. No assertion fails against
  main's current handler.

## Defects

None blocking.

Notes (non-blocking):
- Integration order matters, as the coder stated: this patch requires
  `provider-adapter-refactor` (or the now-committed adapter on main) to be present
  first; on current main `a6b14ab` the adapter exists and the script passes against it.
- If a future protocol is added, `MODELS_PATH_BY_PROTOCOL` needs a matching entry
  (unknown protocols skip, not fail) — already noted as residual risk by the coder.

## Verdict

All five acceptance criteria verified independently: in-process dry-run of every
registry entry with proven zero network + report written; live probe gated to
models endpoints with skip-on-missing-key; redaction verified by test and
inspection; pure unit-tested formatter; tests and build pass with zero regressions.
The script is additionally forward-compatible with main's budget-guard handler.

VERDICT: PASS
