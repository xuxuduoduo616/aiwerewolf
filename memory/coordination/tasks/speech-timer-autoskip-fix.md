# Task: speech-timer-autoskip-fix

## Status

Accepted (2026-07-16, wave 1 cycle 6)

## Objective

Fix the P0 human speech-phase stall: the speech timer must count down to 0 and
trigger the existing auto-skip, so the game advances even when the human never
submits a speech.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/ui-audit-cycle1.md` (issues M01, S01)

## Context

- **Bug (browser-verified, audit M01/S01):** in `src/hooks/useGameState.ts` the
  speech-timer tick at lines 177–182 is
  `setSpeechTimer(v => { if (v === null || v <= 1) return null; return v - 1; })`
  — the value jumps from 1 to `null` and never reaches 0. The auto-skip effect
  at lines 186–191 guards on `if (speechTimer !== 0 || currentSpeaker?.id !== MY_PLAYER_ID) return;`
  and `null !== 0` is true, so it early-returns forever. The human speech phase
  permanently stalls at "轮到你公开发言".
- **Fix:** make the tick land on 0 (`1 → 0`, and stay at 0, never negative,
  `null → null`). With 0 reachable, the existing `speechTimer !== 0` guard is
  already null-safe (null still early-returns, which is correct when the timer
  is inactive) — verify this reasoning holds, do not weaken the guard.
- **Repo test convention:** no jsdom/@testing-library — extract the tick as an
  exported pure helper on `useGameState.ts` (mirror the existing
  `shouldAutoResolveVote` export at line 47, tested by
  `src/deadPlayerVoteAutoresolve.test.ts`) and unit-test the helper. E.g.
  `export const tickSpeechTimer = (v: number | null): number | null => ...`
  used inside the `setInterval` callback.
- Timer cleanup path (effect deps `[currentSpeaker, phase]`, lines 170–184) is
  correct and must keep working: when the auto-skip clears `currentSpeaker`,
  the effect re-runs, sets the timer to `null` and clears the interval.
- Scope boundary: this card fixes ONLY the timer tick + auto-skip reachability.
  No changes to speaking-queue logic, `SPEECH_DURATION`, log wording, or any
  other phase logic.
- Dependencies: none.
- Parallel wave: wave 1, alongside `action-bar-i18n`, `lobby-difficulty-i18n`,
  `dead-player-card-readability`, `speech-input-placeholder-i18n` (no file
  overlap).

## Allowed changes

- `src/hooks/useGameState.ts` (timer tick + auto-skip guard only)
- New test file, e.g. `src/speechTimerAutoskip.test.ts`

## Do not change

- Any other logic in `useGameState.ts` (speaking queue, votes, night phases,
  `SPEECH_DURATION`, log strings).
- `src/App.tsx`, components, `gameEngine.ts`, AI layer, Netlify functions.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. The speech timer counts 60 → … → 1 → 0 (never skips to `null` from 1, never
   goes negative, stays 0 once reached until the effect resets it).
2. When the timer reaches 0 and the current speaker is the human, the existing
   auto-skip fires: log "Time expired." / "发言时间到，自动跳过。" is added once
   and `currentSpeaker` is cleared, letting the phase driver advance the
   discussion (next speaker or voting).
3. An inactive timer (`null`) never triggers the auto-skip.
4. New unit tests cover the exported tick helper (`60→59`, `2→1`, `1→0`, `0→0`,
   `null→null`) and the auto-skip guard semantics (0 + human speaker fires;
   `null` or non-human speaker does not).
5. Baseline 231 tests still pass plus the new tests; zero regressions.
6. `npm run build` succeeds.

## Verification

```bash
npm run test:run   # baseline 231 pass + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/speech-timer-autoskip-fix.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
