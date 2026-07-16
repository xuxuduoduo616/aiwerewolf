# Report: model-routing-cost-guard

## Status

Ready for review

## Summary

Added a per-instance daily budget accumulator, per-provider/model request
counters, and a `budget_remaining` response field to
`netlify/functions/provider-adapter.js`. When the accumulated estimated spend
would exceed the daily ceiling, the handler returns 402 with the local-fallback
signal (`text: ''`, `fallback_used: true`, `model_used: 'local-fallback'`) plus
an `error` field, without making any live provider call — the frontend degrades
to its speech library. All changes are additive; existing response contract
fields and dry-run/circuit-breaker/fallback semantics are unchanged.

## Important integration note (worktree base)

The dispatched worktree HEAD was `b7a8529`, which PRE-DATES wave 1 —
`provider-adapter.js` did not exist there. I fast-forwarded the worktree branch
(`git merge --ff-only 42806e6`) to the main repo HEAD so the patch bases
against the actual wave-1 code. **The patch applies cleanly on `42806e6`**, not
on `b7a8529`. No other git operations (no commit, no new branch, no push).

## Changed files

- `netlify/functions/provider-adapter.js` (+88 lines)
- `netlify/__tests__/provider-adapter.test.js` (+99 lines, 7 new tests)

## Budget design

- **Ceiling**: `ADAPTER_DAILY_BUDGET_USD` env var; invalid/zero/negative values
  fall back to the conservative default `DEFAULT_DAILY_BUDGET_USD = 1.0`.
- **Accumulator**: module-level `{ utcDate, spentUsd }`. Spend is added only on
  successful live provider calls (the same `estimateCost(provider, tokens)`
  figure returned as `cost_estimate`). Dry-run and local-fallback spend nothing.
- **Day rollover**: every read/write goes through `rollBudgetDay(now)` which
  compares `toISOString().slice(0, 10)` UTC dates and zeroes the accumulator on
  change. `now` is injectable for tests (same pattern as the circuit breaker).
- **Guard placement**: after the existing per-call ceiling (which stays), before
  dry-run and before any live call: `cost > budgetRemaining` → 402 with the
  local-fallback signal shape plus `error` and `budget_remaining`.
- **Counters**: `Map` keyed `"provider:model"` (e.g.
  `aicodemirror-claude:claude-sonnet-4-6`), incremented per provider attempted
  in the chain, per dry-run primary route, and for the final local-fallback.
  Exposed via `getRequestCounters()`.
- **Test hook**: `resetBudgetState()` clears the accumulator and counters,
  alongside the existing `resetProviderState()`.
- **Documented limitation** (in-source comment): state is per warm Lambda
  instance — cold starts reset it, parallel instances do not share it. It is a
  per-instance soft guard, not global billing truth (same as the existing rate
  limiter and circuit breaker).
- **Response additions**: `budget_remaining` on all 200 responses (live
  success, dry-run, local-fallback) and on the 402 budget rejection. No keys
  logged; no new env access beyond the budget variable.

## New exports (additive)

`DEFAULT_DAILY_BUDGET_USD`, `getBudgetRemaining(now?)`,
`recordBudgetSpend(usd, now?)`, `getRequestCounters()`, `resetBudgetState(now?)`.

## Verification

- `npm run test:run` — 137/137 passed, 15 files (baseline in this worktree was
  130/130; +7 new budget tests, zero regressions). All network-free.
- `npm run build` — succeeded (same pre-existing non-blocking Gemini import
  warning only).
- `git status --short` — only the two allowed paths modified.

New tests cover: default/env-configurable/invalid budget values,
`budget_remaining` on success plus accumulation across calls, 402 rejection
with local-fallback signal and no live call, UTC day rollover (reset next day,
no reset same day), per-provider/model counters plus reset hook, dry-run
`budget_remaining` without spend, and `budget_remaining` on the
all-providers-failed fallback.

## Residual risks / limitations

- Per-instance state: a burst of parallel Lambda instances can each spend up to
  the ceiling; documented as a soft guard.
- Budget check estimates cost against the primary route only (same convention
  as the existing per-call guard), so a fallback to a pricier provider can
  slightly overshoot the ceiling on the last call of the day.
- Spend uses the prompt-based token heuristic (~4 chars/token), not billed
  output tokens — consistent with the existing `cost_estimate` convention.

## Recommendation

Accept. Apply the patch on `42806e6` (or later); do not attempt to apply on
`b7a8529`. `runtime-model-routing` can consume `budget_remaining` as an
additive field.

- Patch: `memory/coordination/runs/model-routing-cost-guard-claude.patch`
  (written to the MAIN repo runs directory)
- Worktree: `.claude/worktrees/agent-a6c9553348bab03c6`
