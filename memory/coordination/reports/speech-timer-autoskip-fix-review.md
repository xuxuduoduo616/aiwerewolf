# Debugger Review: speech-timer-autoskip-fix

**Role:** $aiwerewolf-debugger
**Date:** 2026-07-16
**Worktree:** /Users/frank/aiwerewolf-worktrees/speech-timer-autoskip-fix

## Scope check

- `git diff` touches only `src/hooks/useGameState.ts` (+25/−5). Untracked:
  `src/speechTimerAutoskip.test.ts` (invisible in `git status` because
  `.gitignore` line 24 `**/*.test.ts` — coordinator must `git add -f` at
  integration) plus card/report copies under `memory/coordination/`.
- No out-of-scope files. Speaking-queue, votes, night phases, `SPEECH_DURATION`,
  and log strings untouched (verified in diff and by grep of all
  `speechTimer`/`setSpeechTimer` sites).

## Findings per criterion

1. **Tick lands on 0, never negative, null-safe** — PASS.
   `tickSpeechTimer` = `null → null`, else `Math.max(0, v - 1)`. Countdown
   60→…→1→0, stays at 0. Old inline `v <= 1 → null` tick removed.
2. **Auto-skip fires at 0 for the human, exactly once** — PASS.
   Guard `!shouldAutoSkipSpeech(speechTimer, currentSpeaker?.id)` is
   boolean-identical (De Morgan) to the old
   `speechTimer !== 0 || currentSpeaker?.id !== MY_PLAYER_ID` — guard strength
   NOT weakened. Effect body unchanged: adds the "Time expired." /
   "发言时间到，自动跳过。" log once and clears `currentSpeaker`; timer effect
   (deps `[currentSpeaker, phase]`) then resets to `null`. Repeated ticks at 0
   return the same value, so React bails and the effect does not re-run —
   single log, no double-submit (the effect never submits a speech, only
   skips).
3. **Inactive timer (null) never triggers auto-skip** — PASS. `null === 0` is
   false; covered by dedicated tests.
4. **Unit tests** — PASS. 13 new tests in `src/speechTimerAutoskip.test.ts`
   cover 60→59, 2→1, 1→0, 0→0, null→null, full-countdown sweep, all guard
   combinations, and a fire-once interaction simulation. Real production
   helpers imported (not simulated copies).
5. **No interference with other timers** — PASS. Wolf countdown
   (`wolfCountdown`, lines 144, 184–191) is a separate state/effect and is
   untouched by the diff. zh/en display unaffected (no string changes).
6. **Reproduced verification** — PASS.
   `npm run test:run`: 22 files, **244/244 passed** (baseline 231 + 13),
   matches coder claim. `npm run build`: succeeded (~1.0s).

## Notes

- Visible behavioral delta: countdown now shows "0" for its final second
  instead of vanishing at 1 — intended per card (0 must be reachable).
- Extracting the guard as `shouldAutoSkipSpeech` is within the card's allowed
  scope ("timer tick + auto-skip guard only") and required to satisfy
  criterion 4 with the repo's no-jsdom convention.
- Integration reminder: `git add -f src/speechTimerAutoskip.test.ts`.

VERDICT: PASS
