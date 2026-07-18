# Task: vote-countdown-diagnosis-and-fix

## Status

Queued

## Objective

Add the missing human vote-phase countdown: a living, vote-holding human entering
`DAY_VOTING` sees an immediately visible 10-second countdown; on timeout the vote
is recorded as abstain and the existing flow advances. Diagnosis-first: write a
failing test reproducing the absence BEFORE implementing the fix.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/tasks/speech-timer-autoskip-fix.md` and
  `memory/coordination/reports/speech-timer-autoskip-fix.md` (closest prior art:
  pure exported timer helpers + tests, no jsdom)
- `src/hooks/useGameState.ts` (speechTimer effect ~lines 213–232, wolfCountdown
  effect + auto-select fallback ~lines 184–211, `shouldAutoResolveVote` line 47,
  `finishVote` ~line 615, `handlePlayerAction` DAY_VOTING branch ~line 758)
- `src/App.tsx` (existing timer pills: `wolfCountdown` ~line 275, `speechTimer`
  ~line 278 with the `urgent` class — reuse this rendering idiom)
- `src/components/ActionBar.tsx` (vote buttons, `canVote` handling)
- `src/gameEngine.ts` (`resolveVoteResult`, `createVoteRecords` — read-only)

## Context

- **Coordinator-verified fact:** there is currently NO vote countdown code at
  all. Grep confirms only `speechTimer` (60s, DAY_DISCUSSION) and
  `wolfCountdown` (20s, NIGHT_WEREWOLVES) exist. Therefore the "diagnosis" step
  is: build a failing test FIRST that reproduces "human enters `DAY_VOTING` →
  no countdown state exists / nothing auto-resolves on timeout", commit to the
  red state in the report, then implement the fix and turn it green.
- **Existing patterns to REUSE (do not invent new idioms):**
  - `speechTimer`/`wolfCountdown` are `number | null` state, `null` = inactive,
    effect keyed on phase sets the value and a 1s `setInterval`, cleanup clears
    the interval, a separate effect fires the terminal action at 0
    (`shouldAutoSkipSpeech`, wolf auto-select). Mirror this shape for the vote
    timer: keep a UI-facing integer-seconds `number | null` state.
  - BUT: unlike the pure decrement tick, derive the displayed seconds from a
    fixed DEADLINE timestamp captured when the countdown starts
    (`deadline = now() + VOTE_DURATION_MS`), with `now` injectable
    (`Date.now`/`performance.now`) for tests. Each interval tick recomputes
    `remaining = max(0, ceil((deadline - now()) / 1000))`. Decrement counting
    must NOT be the sole source of truth — this makes background tabs /
    throttled intervals correct: on resume the next tick lands on the real
    remaining value (or 0), and Strict Mode duplicate effect runs recompute the
    same value instead of double-decrementing.
  - Export the pure helpers (e.g. `computeVoteRemaining(deadline, now)`,
    `shouldAutoResolveVoteTimeout(...)`) next to `shouldAutoResolveVote` /
    `tickSpeechTimer` and unit-test them — the repo test convention is pure
    helpers, no jsdom/@testing-library (see `src/speechTimerAutoskip.test.ts`,
    `src/deadPlayerVoteAutoresolve.test.ts`).
- **Single constant:** `VOTE_DURATION_MS = 10_000` (one definition, used for
  both deadline math and any display derivation; no scattered `10`s).
- **When the countdown runs:** ONLY when `phase === DAY_VOTING` AND the human
  is alive AND `me.canVote` AND the human has not yet voted this vote round.
  Dead human, vote-stripped human (revealed Idiot), and AI-only voting show NO
  human countdown (the existing `shouldAutoResolveVote` path already handles
  dead/no-vote auto-resolution — do not disturb it).
- **Timeout semantics:** call the existing `finishVote(null)` (abstain path —
  logs "你无票或弃票。"). NEVER auto-vote a random player on timeout. The
  wolf-countdown auto-SELECT fallback is intentionally NOT the model here.
- **Repeat-submission lock:** confirm vote (or timeout) must stop the timer and
  lock further submissions. `finishVote` is async (`runAIPhaseSafely` sets
  `isProcessingAI`), but there is a window before the flag is set — guard
  against a click and the timeout both firing (e.g. clear the deadline
  synchronously before invoking `finishVote`, and make the timeout effect
  no-op once the deadline is cleared). Exactly one `finishVote` call per vote
  round, ever.
- **Reset semantics:** every fresh entry into `DAY_VOTING` (new day; tie leads
  to a later new vote; any future revote) gets a fresh full 10s — key the
  effect so re-entry restarts the deadline (phase + roundCount, mirroring the
  wolf effect's `[phase, roundCount]` deps). Leaving the phase, new game,
  game over, or unmount → deadline cleared, interval cleared, timer state
  `null`. A rerender within the same vote round must NOT reset or restart the
  countdown (deadline is captured once per entry, not per render).
- **RULE LOGIC FROZEN:** `src/gameEngine.ts` vote legality/resolution
  (`resolveVoteResult`, tie handling, Idiot rules) must not change. This card
  adds a timer around the EXISTING flow only.
- Scope boundary: vote countdown state + timeout auto-abstain + countdown pill
  UI. No changes to speech timer, wolf countdown, speaking queue, AI voting,
  or any night logic.
- Dependencies: none (starts from current `HEAD`; independent of
  `ai-speech-roster-name-fix`, which touches disjoint files).
- Parallel wave: wave A, alongside `cloud-tts-adapter-spike` (docs-only, no
  file overlap). NOT parallel with `browser-tts-mvp` — both cards touch
  `src/App.tsx` and `src/hooks/useGameState.ts`, so `browser-tts-mvp` runs
  AFTER this card is accepted.

## Allowed changes

- `src/hooks/useGameState.ts` (vote countdown state, deadline helpers, timeout
  effect, `VOTE_DURATION_MS`; export the new pure helpers)
- `src/App.tsx` (vote countdown pill ONLY — reuse the existing `timer-pill` /
  `urgent` rendering used by `speechTimer`/`wolfCountdown`; no other UI edits)
- New test file, e.g. `src/voteCountdown.test.ts`

## Do not change

- `src/gameEngine.ts` (vote legality/resolution rules frozen).
- `src/components/ActionBar.tsx`, AI layer, `netlify/**`, `package.json`.
- Existing speech-timer / wolf-countdown logic, `shouldAutoResolveVote`.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. Failing-test-first evidence: the report shows the new timeout/countdown test
   red against the unmodified baseline (no vote countdown exists), then green
   after the fix.
2. A living human with a vote entering `DAY_VOTING` sees a countdown pill
   immediately (starting at 10); single constant `VOTE_DURATION_MS = 10_000`.
3. Display is integer seconds with stable visual progress — no size jumps and
   no reset/restart on unrelated rerenders within the same vote round.
4. Confirming a vote stops the timer and locks repeat submission; timeout and
   click can never both resolve the same vote round (exactly one
   `finishVote` call).
5. Timeout records the human as abstain via `finishVote(null)` and the
   existing flow advances (AI votes tally, result resolves). The human is
   NEVER randomly voted for.
6. Fresh entry into `DAY_VOTING` (new day / any revote) restarts a full 10s;
   leaving the phase, game over, new game, or unmount cleans up the old timer
   (no orphan intervals, state returns to `null`).
7. Dead human, vote-stripped human (Idiot), and AI auto-vote flows show no
   human countdown and are behaviorally unchanged.
8. Remaining time is derived from the fixed deadline with an injectable clock:
   after simulated background-tab drift (clock jumps forward), the next tick
   shows the true remaining value or fires the timeout — decrement drift
   cannot extend the countdown. React Strict Mode / duplicate effect runs do
   not create parallel timers or double-fire the timeout.
9. Required tests, each explicit: (a) normal 10s decrement 10→0;
   (b) cancel on vote confirm; (c) timeout → abstain resolution;
   (d) tie/new-entry reset to full 10s; (e) rerender within the phase does not
   reset; (f) unmount/phase-leave cleanup; (g) background-drift correctness via
   injected clock; (h) no double-submit (timeout + click race).
10. Baseline tests still pass (309+ or current baseline at dispatch), zero
    regressions; `npm run build` succeeds.

## Verification

```bash
npm run test:run   # 309+ (or current baseline) + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/vote-countdown-diagnosis-and-fix.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, the red→green failing-test evidence,
  verification commands and results, decisions, residual risks, and a
  recommendation to the coordinator.
