# Report: dead-player-vote-autoresolve

## Status

Ready for review

## Root cause

The phase-transition driver in `src/hooks/useGameState.ts` (useEffect, ~lines 146-172)
had branches for every auto-advancing phase except `DAY_VOTING`. `finishVote` was only
ever invoked from a human click (`handlePlayerAction` VOTE branch, or the "NO VOTE"
button via `onVoteSkip` in `App.tsx`). When the human player was dead (or had lost
their vote as a revealed Idiot), no click was required by the rules but one was still
needed to trigger the vote — the game soft-locked on `DAY_VOTING` indefinitely
(4+ minutes observed in cycle-2 browser QA) until the dead spectator clicked "NO VOTE".

## Fix design

Minimal, driver-only change in `src/hooks/useGameState.ts`:

1. New exported pure predicate (testable without rendering the hook):

   ```ts
   export const shouldAutoResolveVote = (
     phase: GamePhase,
     me: Pick<Player, 'isAlive' | 'canVote'> | undefined
   ): boolean => phase === GamePhase.DAY_VOTING && !(me?.isAlive && me.canVote);
   ```

2. New branch appended to the existing phase-driver `setTimeout` (same 700 ms delay
   as every other auto-advancing phase):

   ```ts
   else if (shouldAutoResolveVote(phase, me)) finishVote(null);
   ```

Behavior:

- Dead human (or alive human with `canVote === false`) → `finishVote(null)` fires
  automatically 700 ms after entering `DAY_VOTING`. `finishVote` already handles
  `humanTargetId = null` via its `humanCanVote` check, so the human is recorded as
  no-vote and AI voters run unchanged.
- Living human with a vote → the predicate is false; the driver does nothing and the
  game still waits indefinitely for their click. `finishVote` semantics for living
  humans, vote tally (`resolveVoteResult`), vote records (`createVoteRecords`),
  idiot/hunter handling: all untouched.

Double-fire analysis:

- `finishVote` sets `isProcessingAI = true` as its first statement; the driver's
  top-level guard (`if (winner || !players.length || isProcessingAI) return`) blocks
  every effect re-run while the vote is processed, and each re-render clears the
  pending timer via the effect cleanup.
- The "NO VOTE" button (`ActionBar.tsx`) is `disabled={isProcessingAI}`, so a dead
  spectator cannot race the auto-resolve: whichever path calls `finishVote` first
  commits `isProcessingAI = true` before the other can fire (timer callbacks and click
  handlers are separate macrotasks; React 18 commits batched updates between them).
- The living-human VOTE path is unreachable from the new branch (predicate is false
  whenever the human can vote), so a living human's click is never raced.

## Changed files

- `src/hooks/useGameState.ts` — +13 lines: exported `shouldAutoResolveVote` predicate
  plus one `else if` branch in the phase driver. No other logic touched.
- `src/deadPlayerVoteAutoresolve.test.ts` — new regression test file (12 tests),
  following the pure-logic simulation style of `guestLobbyTransition.test.ts` /
  `integration.test.ts` (repo has no `@testing-library`/jsdom, so the hook cannot be
  rendered; the predicate is exercised directly and the driver guard contract is
  simulated faithfully):
  - dead human during `DAY_VOTING` → auto-resolve (9- and 12-player boards)
  - living human with a vote → waits, never auto-resolves (both boards)
  - alive human without a vote (revealed Idiot) → auto-resolve (both boards)
  - never fires in any other phase (both boards)
  - `me === undefined` defensive case
  - driver-guard simulation: `finishVote` fires at most once across repeated effect
    re-runs (`isProcessingAI` guard); never fires for a living human; skipped when
    `winner` is set or `players` is empty

## Verification

```
npm run test:run   → 18 files, 175/175 passed (baseline 163 + 12 new, zero regressions)
npm run build      → succeeded (tsc + vite)
```

`git status --short` staged content: only the two files above (the `node_modules`
symlink and the local `dist/` build output were excluded from the patch).

Patch: `memory/coordination/runs/dead-player-vote-autoresolve-claude.patch`
(174 insertions, 2 files) — written to the MAIN repo runs directory.

Note: this report lives in the worktree copy of `memory/coordination/reports/`
because direct writes to the main-repo reports path are blocked for isolated
workers; the coordinator should copy it over on acceptance.

## Decisions

- Delay reused from the existing driver timer (700 ms) rather than a bespoke longer
  delay — the card asks for consistency with other auto-advancing phases, and
  `finishVote` itself already paces AI votes at 180 ms per voter.
- Predicate covers `canVote === false` while alive (revealed Idiot), matching the
  card's `!me?.isAlive || !me.canVote` fix direction, not just death.
- No new test dependencies added; tests follow the existing pure-simulation pattern.

## Residual risks

- The driver-guard test simulates the effect contract rather than rendering the hook
  (no renderHook tooling in the repo). The predicate itself is real exported code; the
  React wiring (one `else if` line) is exercised by build/type-check and matches the
  seven existing branches. A browser spot-check of a dead-human game is still the
  strongest end-to-end evidence for the debugger round.
- The "NO VOTE" button remains visible for ~700 ms before auto-resolve kicks in;
  clicking it early is safe (same `finishVote(null)`, mutually excluded by
  `isProcessingAI`). Removing the button was out of scope (UI file not allowed).

## Recommendation

Accept. The change is 13 lines in the allowed file plus tests, root-causes the
soft-lock at the driver level, and leaves all vote semantics unchanged. Suggest the
debugger verify with a browser run where the human is exiled on day 1 (9-player) and
confirm day-2 voting resolves unattended.
