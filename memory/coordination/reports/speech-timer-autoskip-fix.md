# Worker Report: speech-timer-autoskip-fix

**Role:** $aiwerewolf-coder
**Date:** 2026-07-16
**Status:** Ready for review

## Changed files

- `src/hooks/useGameState.ts` — timer tick + auto-skip guard only:
  - Added exported pure helper `tickSpeechTimer(value: number | null)`:
    `null → null`, otherwise `Math.max(0, value - 1)` — counts 60 → … → 1 → 0,
    stays at 0, never negative, never jumps from 1 to `null`. Mirrors the
    existing wolf-countdown tick style (`Math.max(0, value - 1)`).
  - The speech-timer `setInterval` callback now calls
    `setSpeechTimer(tickSpeechTimer)` (previously the inline
    `v <= 1 → null` tick that caused the stall).
  - Added exported pure helper `shouldAutoSkipSpeech(speechTimer, currentSpeakerId)`
    = `speechTimer === 0 && currentSpeakerId === MY_PLAYER_ID`. The auto-skip
    effect guard is now `if (!shouldAutoSkipSpeech(speechTimer, currentSpeaker?.id)) return;`
    — boolean-identical to the old
    `if (speechTimer !== 0 || currentSpeaker?.id !== MY_PLAYER_ID) return;`
    (De Morgan), so the guard is NOT weakened: `null` still early-returns.
- `src/speechTimerAutoskip.test.ts` — new, 13 tests (pure-helper pattern,
  no jsdom, mirrors `deadPlayerVoteAutoresolve.test.ts` conventions).

## Decisions

1. **Extracted the guard as a second exported helper** (in addition to the
   tick required by the card). Acceptance criterion 4 requires unit tests of
   the auto-skip guard semantics; exporting the identical predicate lets the
   tests exercise the real production logic instead of a simulation. Both
   helpers live next to `shouldAutoResolveVote` / `runAIPhaseSafely` with
   matching doc comments. This stays within the card's allowed scope
   ("timer tick + auto-skip guard only").
2. **Stay-at-0 semantics via `Math.max(0, v - 1)`**: after the auto-skip fires,
   further interval ticks return 0 again; React bails on same-value setState,
   so the `[speechTimer]` effect does not re-run — the "Time expired." /
   "发言时间到，自动跳过。" log is added exactly once. The auto-skip then clears
   `currentSpeaker`, the timer effect (deps `[currentSpeaker, phase]`) re-runs,
   resets the timer to `null`, and clears the interval — the existing cleanup
   path is untouched.
3. Verified the card's null-safety reasoning: with 0 reachable, the unchanged
   guard strength is correct — `null` (inactive timer) never fires the skip;
   covered by dedicated tests.

## Verification (run in this worktree)

```bash
npm run test:run   # 22 files, 244/244 passed (baseline 231 + 13 new), zero regressions
npm run build      # TypeScript + Vite production build succeeded (built in ~1.0s)
```

New test coverage:
- `tickSpeechTimer`: 60→59, 2→1, 1→0, 0→0, null→null, full 60-tick countdown
  hits every value, never negative, never emits null mid-countdown.
- `shouldAutoSkipSpeech`: 0 + human fires; `null`, non-human speaker,
  undefined speaker, and running timer (60, 1) all do not fire.
- Tick + guard interaction: human speaker's timer expiry fires the auto-skip
  exactly once (React same-value bail modeled); AI-speaker/inactive timer
  never fires.

## Residual risks

- Low. The behavioral delta for the UI is that the visible countdown now shows
  "0" for the final second instead of disappearing at 1 — this is the intended
  fix (0 must be reachable). No changes to speaking queue, `SPEECH_DURATION`,
  log wording, or other phase logic.
- The auto-skip effect deps remain `[speechTimer]` (unchanged per card scope);
  its interplay with the timer-reset path is covered by reasoning + simulation
  test, not a browser run. Recommend the debugger include a quick browser check
  of one human speech timeout (let the 60s expire) if feasible.

## Recommendation

Accept. Minimal diff (1 source file + 1 test file), acceptance criteria 1–6
all satisfied, zero regressions.

## Note to coordinator

The dispatcher had not copied `tasks/speech-timer-autoskip-fix.md` into this
worktree; I copied it verbatim from the main repo (read-only) so the worktree
card's Status could be updated per protocol.
