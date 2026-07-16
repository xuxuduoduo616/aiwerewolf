# Task: dead-player-vote-autoresolve

## Status

Queued

## Objective

P0 bug fix: when the human player is dead (or otherwise has no vote), `DAY_VOTING` must auto-resolve after a reasonable delay without requiring the dead spectator to click "NO VOTE". Living humans with a vote must still be waited on.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/browser-verification-cycle2.md` (finding #1 — QA evidence)

## Context

- **QA evidence (cycle 2, finding #1)**: after the human was exiled on day 1, the day-2 vote never auto-resolved. The game stalled 4+ minutes until the dead spectator manually clicked the enabled "NO VOTE" button.
- **Root cause**: the phase-transition driver in `src/hooks/useGameState.ts` (useEffect around lines 146-159) has branches for `NIGHT_START`, `NIGHT_WEREWOLVES`, `NIGHT_SEER`, `NIGHT_WITCH`, `DAY_ANNOUNCE`, `DAY_HUNTER_CHECK`, and `DAY_DISCUSSION` — but **no `DAY_VOTING` branch**. `finishVote` (line 503) is only ever triggered by a human click via `handlePlayerAction` (lines 637-639) or the "NO VOTE" button. When the human cannot vote, nothing fires.
- **Fix direction**: add a `DAY_VOTING` branch to the phase driver, consistent with how the other phases auto-advance (the driver already gates on `winner`, `players.length`, and `isProcessingAI`, and uses a `setTimeout`). In that branch, when the human cannot vote (`!me?.isAlive || !me.canVote`), call `finishVote(null)` after a reasonable delay. When the human is alive and can vote, do nothing — keep waiting for their click. Note `finishVote` already handles `humanTargetId = null` correctly via `humanCanVote` (line 507), so `finishVote(null)` records the human as no-vote and runs the AI voters unchanged.
- **Guard against double-fire**: `finishVote` sets `isProcessingAI = true` immediately, and the driver skips while `isProcessingAI` is true — verify the new branch cannot invoke `finishVote` twice (e.g. effect re-run before state settles) and cannot fire while a living human's click is being processed.
- **Scope boundary**: phase-driver change only. Do NOT change vote tally logic (`resolveVoteResult`), `finishVote` semantics for a living human, vote records (`createVoteRecords`), or AI voter behavior.
- **Dependencies**: none.
- **Parallel wave**: wave 3 — may run concurrently with `speech-quality-filter` and `en-display-translation-improvement` (non-overlapping paths).

## Allowed changes

- `src/hooks/useGameState.ts` — phase-transition driver (`DAY_VOTING` branch) only
- Test files (new or existing) for regression coverage

## Do not change

- `finishVote` vote-tally logic, vote-record creation, elimination/hunter/idiot handling, or its behavior when a living human votes.
- `src/App.tsx`, UI components, AI orchestration, or any other module.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. Dead human + phase `DAY_VOTING` → the vote auto-resolves (AI votes cast, tally computed, phase advances) with no human interaction, after a reasonable delay.
2. Living human with `canVote` → `DAY_VOTING` still waits indefinitely for their click; no auto-resolve fires.
3. `finishVote` is invoked at most once per voting round (no double vote records, no duplicate logs).
4. Vote tally, tie handling, idiot-spared handling, hunter-shot handling, and vote records are byte-for-byte unchanged in behavior.
5. Regression tests cover: dead human → auto-resolve; living human → waits; both on 9-player and 12-player boards.
6. Baseline 163 tests still pass, plus the new tests; zero regressions.

## Verification

```bash
npm run test:run   # baseline 163 pass + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/dead-player-vote-autoresolve.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
