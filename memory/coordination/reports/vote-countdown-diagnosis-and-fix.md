# Worker Report: vote-countdown-diagnosis-and-fix

**Role:** $aiwerewolf-coder
**Date:** 2026-07-18
**Status:** Ready for review

## Diagnosis

Confirmed: there was NO vote countdown code before this fix. Only `speechTimer` (60s, DAY_DISCUSSION) and `wolfCountdown` (20s, NIGHT_WEREWOLVES) existed. A living human with a vote entering `DAY_VOTING` was waited on indefinitely — no timer, no auto-resolution. The `shouldAutoResolveVote` path only fires for dead/vote-stripped humans.

## Changed files

- `src/hooks/useGameState.ts` — vote countdown state, deadline helpers, timeout effects, constant:
  - Added `VOTE_DURATION_MS = 10_000` (single constant, no scattered 10s).
  - Added `nowFn: () => number` (module-level injectable clock, defaults to `Date.now`).
  - Added pure helper `computeVoteRemaining(deadline, now)` — returns `max(0, ceil((deadline - now) / 1000))`, background-tab safe.
  - Added pure helper `shouldAutoResolveVoteTimeout(deadline, now)` — true when deadline is reached; null deadline returns false.
  - Added `voteDeadline` and `voteTimer` state (both `number | null`).
  - Added vote countdown setup effect (deps `[phase, roundCount, me?.isAlive, me?.canVote]`): sets deadline on entry, clears on exit, interval derives displayed seconds from deadline each tick.
  - Added vote countdown timeout effect (deps `[voteTimer, isProcessingAI, phase]`): fires `finishVote(null)` (abstain) when deadline expires, guarded by `isProcessingAI` and `voteDeadline` checks to prevent double-submit.
  - Modified `finishVote`: clears `voteDeadline`/`voteTimer` synchronously BEFORE the async body, preventing a click/timeout race.
  - Returned `voteTimer` from the hook.
- `src/App.tsx` — vote countdown pill (lines 278-282):
  - Rendered between wolfCountdown and speechTimer pills using existing `timer-pill` CSS with `urgent` class at `<= 3` seconds.
- `src/voteCountdown.test.ts` — new, 19 tests (pure-helper pattern, no jsdom):
  - (a) 7 tests: `computeVoteRemaining` normal 10s decrement 10→0, ceiling behavior
  - (b+c) 4 tests: `shouldAutoResolveVoteTimeout` timeout predicate + cancel/null guard
  - (g) 2 tests: background-drift correctness via injected clock
  - (d) 1 test: new roundCount produces fresh 10s deadline
  - (e) 1 test: rerender within phase preserves original deadline
  - (f) 1 test: phase-leave cleanup clears deadline
  - (h) 3 tests: no double-submit (click→timeout, timeout→click, null-guard)

## Failing-test-first evidence (red → green)

### Red state

Before the implementation, the test file imported `computeVoteRemaining`, `shouldAutoResolveVoteTimeout`, and `VOTE_DURATION_MS` from `useGameState.ts` — none of which existed. Running `npm run test:run -- src/voteCountdown.test.ts` produced:

```
19 tests | 17 failed
  computeVoteRemaining is not a function
  shouldAutoResolveVoteTimeout is not a function
```

The 17 failures confirmed the absence: no vote countdown code existed, exactly as diagnosed.

### Green state

After adding all exports, state, effects, and UI changes, the same test command produced:

```
19 tests passed
```

Full suite: `328 passed | 5 skipped (333)` — baseline 309 + 19 new, zero regressions.

## Verification

```bash
npm run test:run   # 28 files, 328 passed, 5 skipped (baseline 309 + 19 new), zero regressions
npm run build      # TypeScript + Vite production build succeeded (built in 955ms)
```

## Decisions

1. **Deadline-based timing with injectable clock**: displayed seconds are derived from `ceil((deadline - nowFn()) / 1000)` each tick, not a decrement counter. Background tabs / throttled intervals compute the true remaining time on next tick. `nowFn` defaults to `Date.now` and can be replaced by tests.

2. **Reused existing patterns exactly**: the setup effect mirrors the wolf countdown (`[phase, roundCount]` deps, interval creation/cleanup), the timeout effect mirrors the wolf auto-select (watches the timer value, guarded by multiple conditions), and the UI pill uses the same `timer-pill` + `urgent` CSS classes.

3. **Double-submit lock**: `finishVote` clears `voteDeadline` and `voteTimer` synchronously before the async body. The timeout effect guards on `!voteDeadline || isProcessingAI`. React 18 batches the state updates from `handlePlayerAction` (event handler), so both guards take effect in a single render.

4. **No auto-vote**: timeout calls `finishVote(null)` — the existing abstain path ("你无票或弃票。") — never auto-votes a random player.

5. **Complement to existing `shouldAutoResolveVote`**: `shouldAutoResolveVote` handles dead/vote-stripped humans (auto-resolves immediately). The new vote countdown handles alive, vote-holding humans (waits 10s, then auto-abstains). These paths are mutually exclusive and don't overlap.

6. **Only fires for alive, vote-holding humans**: the setup effect guards `phase === DAY_VOTING && me?.isAlive && me.canVote`. Dead humans, revealed Idiots, and AI-only voting show no countdown. The existing `shouldAutoResolveVote` path in the phase driver handles those cases unchanged.

## Acceptance criteria coverage

| Criterion | Status |
|---|---|
| 1. Failing-test-first evidence | Red→green documented above |
| 2. Countdown pill at 10, single constant | `VOTE_DURATION_MS = 10_000` |
| 3. Stable integer display, no reset on rerender | Deadline captured once per entry; test (e) |
| 4. Vote confirms stop timer, double-submit locked | Synchronous deadline clear + guards; test (h) |
| 5. Timeout records abstain, not random vote | `finishVote(null)` → abstain path |
| 6. Fresh entry restarts 10s, cleanup on exit | Effect deps `[phase, roundCount, ...]`; test (d,f) |
| 7. Dead/vote-stripped/auto-vote no countdown | Setup effect guards; existing `shouldAutoResolveVote` unchanged |
| 8. Deadline-based, injectable clock | `computeVoteRemaining` recomputes from deadline; test (g) |
| 9. All 8 test cases | 19 tests covering (a)-(h), each discrete |
| 10. Baseline 309+ pass, build succeeds | 328 passed, build OK |

## Residual risks

- Low. The vote countdown follows the same patterns as `speechTimer`/`wolfCountdown` which have been battle-tested through multiple cycles. The deadline-based approach eliminates decrement drift.
- The timeout effect has `voteTimer` in its dep array, which changes each second. In React Strict Mode, the duplicate effect run is no-op (voteTimer !== null but deadline not yet expired, or voteTimer is null after cleanup). No double-fire.
- `finishVote` is called from two paths (timeout effect and phase driver for dead-human auto-resolve), but they're disjoint by guard condition. The phase driver's `isProcessingAI` guard prevents overlap during the async vote collection.
- Recommend the debugger do a quick browser check of one human vote timeout to verify the pill appears and the auto-abstain advances the phase.

## Recommendation

Accept. Minimal diff (2 source files + 1 test file), all acceptance criteria satisfied, zero regressions. The implementation reuses existing timer patterns exactly, with one safety enhancement (deadline-based timing) for background-tab correctness.
