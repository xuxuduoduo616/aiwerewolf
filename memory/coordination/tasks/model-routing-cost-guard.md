# Task: model-routing-cost-guard

## Status

Accepted

## Objective

Extend `netlify/functions/provider-adapter.js` with a per-instance budget accumulator (env-configurable daily/session ceiling, conservative default), per-provider/model request counters, and a `budget_remaining` status field in responses — rejecting with 402 plus the local-fallback signal when the budget is exceeded.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `netlify/functions/provider-adapter.js` (the file to extend — from card `provider-adapter-refactor`)
- `netlify/__tests__/provider-adapter.test.js` (its tests — extend, keep all passing)
- `netlify/functions/model-adapter.js` (per-call cost-guard convention to stay consistent with)

## Context

- **Parallel wave: Wave 2**. Dependencies: `provider-adapter-refactor` (must be Accepted first). WARNING for the coordinator: this card and `provider-adapter-dry-run` both read provider-adapter.js, but only THIS card writes it — do not run it concurrently with any other card that edits `netlify/functions/provider-adapter.js` or its test file.
- **Budget accumulator**: per-warm-instance (module-level state), accumulating estimated cost across calls. Env-configurable ceiling (e.g. `ADAPTER_DAILY_BUDGET_USD`), default conservative: $1/day/instance. Reset on day rollover (UTC date compare is sufficient). Document clearly in a comment that Lambda instances don't share state, so this is a per-instance soft guard, not global billing truth.
- **Counters**: request counts per provider/model since instance start.
- **Response status**: successful responses gain a `budget_remaining` field. The existing response contract fields (`text`, `model_used`, `cost_estimate`, `fallback_used`) must remain unchanged — additive only, since `runtime-model-routing` consumes this contract.
- **Rejection**: when the accumulated budget would be exceeded, return 402 with the local-fallback signal shape (`text: ''`, `fallback_used: true`) plus an explanatory error field, so the frontend degrades to the speech library.
- Provide a test hook to reset accumulator/counters between tests (follow whatever state-reset pattern `provider-adapter-refactor` established for the circuit breaker).
- The existing per-call cost ceiling stays; the budget is an additional cumulative layer.
- No keys anywhere; env only.
- Scope boundary: this one server function and its test file. No frontend changes, no new files.

## Allowed changes

- `netlify/functions/provider-adapter.js`
- `netlify/__tests__/provider-adapter.test.js`

## Do not change

- `netlify/functions/genai-proxy.js`, `netlify/functions/model-adapter.js`, any frontend file, other test files.
- The existing provider-adapter response contract fields (additive only).
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. Budget ceiling is env-configurable with a $1/day/instance default; accumulated estimated cost is tracked per instance and resets on UTC day rollover.
2. Exceeding the budget returns 402 with the local-fallback signal (`text: ''`, `fallback_used: true`) and never makes a live provider call.
3. Successful responses include `budget_remaining`; all pre-existing response fields are unchanged.
4. Per-provider/model request counters exist and are test-observable.
5. All pre-existing provider-adapter tests still pass; new tests cover budget accumulation, rejection, rollover reset, and counters — all network-free.
6. `npm run test:run` and `npm run build` pass with zero regressions.

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/model-routing-cost-guard.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
