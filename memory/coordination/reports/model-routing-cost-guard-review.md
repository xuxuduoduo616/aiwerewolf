# Review: model-routing-cost-guard

**Role:** Debugger (independent verification, no product code edited)
**Date:** 2026-07-16
**Worktree:** `.claude/worktrees/agent-a6c9553348bab03c6` (HEAD `42806e6`)
**Patch:** `memory/coordination/runs/model-routing-cost-guard-claude.patch`

## 1. Scope check

`git status --short` in the worktree:

```
M  netlify/__tests__/provider-adapter.test.js
M  netlify/functions/provider-adapter.js
?? memory/coordination/reports/model-routing-cost-guard.md
?? node_modules
```

Only the two allowed paths are modified. Untracked entries are the coder's
own report and `node_modules` (build artifact) — no scope violation. The
patch file is byte-identical to `git diff HEAD` in the worktree (verified
with `diff`). The test-file diff is purely additive: the only removed line
in the whole patch is in provider-adapter.js, where
`cost_estimate: estimateCost(provider, tokens)` became
`cost_estimate: callCost` with `callCost = estimateCost(provider, tokens)`
hoisted one line up so the same figure feeds `recordBudgetSpend` — a
semantically identical, necessary change.

## 2. Patch check (main repo, check only — never applied)

`git apply --check memory/coordination/runs/model-routing-cost-guard-claude.patch`
from `/Users/frank/aiwerewolf` — clean, no output, exit 0.

## 3. Reproduction

In the worktree:

- `npm run test:run` — **137/137 passed, 15 files** (matches expected count).
- `npm run build` — succeeded; only the pre-existing non-blocking Gemini
  chunk warning.
- Baseline isolation: with the changes stashed,
  `npx vitest run netlify/__tests__/provider-adapter.test.js` passes
  **15/15** — the 15 pre-existing adapter tests run unmodified and pass;
  the 7 new tests account for 130 → 137.

## 4. Per-criterion compliance

1. **Env-configurable ceiling, $1 default, UTC rollover** — PASS.
   `getDailyBudgetUsd()` (provider-adapter.js:209-212) uses
   `Number.isFinite(configured) && configured > 0`, so NaN, `'0'`, and
   negative values all fall back to `DEFAULT_DAILY_BUDGET_USD = 1.0`.
   `rollBudgetDay()` (:221-227) compares `toISOString().slice(0,10)` UTC
   dates and zeroes the accumulator on change; every read/write path
   (`getBudgetRemaining`, `recordBudgetSpend`) rolls first. `now` is
   injectable, matching the circuit-breaker pattern. Tests cover default,
   `2.5` override, `not-a-number`, `0`, `-3` (test.js:357-369) and
   same-day vs next-day rollover with real UTC timestamps (:399-408).
2. **402 + local-fallback signal, no live call** — PASS. The budget guard
   (provider-adapter.js:451-465) sits after the per-call ceiling and
   before dry-run and the provider loop; on `cost > budgetRemaining` it
   returns 402 with `text: ''`, `fallback_used: true`,
   `model_used: 'local-fallback'`, `cost_estimate: 0`, an `error` field,
   and `budget_remaining`. The test (:383-397) exhausts the budget via
   `recordBudgetSpend` and asserts status 402, the full signal shape, and
   that neither `fetch` nor the Gemini SDK constructor was invoked.
3. **`budget_remaining` on responses, contract additive-only** — PASS.
   Present on live success (:511), dry-run (:486), all-providers-failed
   fallback (:528), and the 402 budget rejection (:462).
   `getBudgetRemaining` clamps with `Math.max(0, ...)` (:231), so it is
   never negative even when spend overshoots. All pre-existing contract
   fields (`text`, `model_used`, `cost_estimate`, `fallback_used`) are
   unchanged; tests assert them alongside the new field (:374-378).
4. **Per-provider/model counters, test-observable** — PASS. `Map` keyed
   `provider:model` (:239-245), incremented per attempted chain provider
   (after the open-breaker skip, so skipped providers are not counted),
   for the dry-run primary route, and for the terminal local fallback.
   Exposed via `getRequestCounters()`; `resetBudgetState()` clears
   counters and accumulator. Test (:410-428) drives a success plus a
   full-chain failure and asserts exact per-key counts and the reset hook.
5. **Accounting** — PASS. Spend is recorded exactly once, only on a
   successful live call, using the succeeding provider's own estimated
   cost (the same figure returned as `cost_estimate`) — no
   double-counting across the fallback chain; failed attempts, dry-run,
   and local fallback spend nothing (asserted at test.js:430-452).
6. **Existing semantics unchanged** — PASS. Per-call ceiling, dry-run
   mock, circuit breaker, error classification, CORS headers, prompt
   truncation, and log redaction are untouched; verified by diff
   inspection and by the stashed-baseline run in section 3.
7. **Verification commands** — PASS. `npm run test:run` 137/137 and
   `npm run build` clean, zero regressions.

## 5. Defects

None blocking. Notes for the coordinator (informational, not defects):

- **Process deviation (disclosed, low):** the dispatched worktree HEAD was
  `b7a8529` (pre-wave-1; provider-adapter.js did not exist), and the coder
  ran `git merge --ff-only 42806e6` to reach a valid base, despite the
  card's no-merge rule. The deviation is disclosed in the coder report,
  was strictly a fast-forward with no commit/branch/push, and the review
  brief itself designates `42806e6` as the base. Flagging for awareness;
  the dispatcher should hand out worktrees from the current HEAD.
- **Design note (low):** with the budget exhausted, dry-run mode also
  returns 402 (the guard precedes the dry-run branch). This is internally
  consistent (dry-run never spends, so it only triggers after real spend
  or an explicit test-hook spend) and covered by tests, but worth knowing
  when using dry-run for smoke checks.
- **Documented limitation:** per-warm-instance soft guard (comment at
  provider-adapter.js:199-205); budget check estimates against the
  primary route, so a pricier fallback can slightly overshoot on the last
  call of the day — both acknowledged in the coder report and consistent
  with the existing per-call guard convention.

VERDICT: PASS
