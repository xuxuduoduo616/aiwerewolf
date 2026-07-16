# Debugger Review: dead-player-vote-autoresolve

Reviewer: DEBUGGER (independent verification)
Date: 2026-07-16
Patch: `memory/coordination/runs/dead-player-vote-autoresolve-claude.patch`
Worktree: `.claude/worktrees/agent-a5cad55b18c275ffa`

## 1. Scope and patch apply

- `git apply --check` against the main repo: clean, no conflicts.
- Patch touches exactly 2 files (175 insertions):
  - `src/hooks/useGameState.ts` (+13) — allowed by the card
  - `src/deadPlayerVoteAutoresolve.test.ts` (new, +161) — allowed (test files)
- Worktree working set matches: only those two files plus the task card status
  line (worker is required to set the card to `Ready for review`). No forbidden
  files (`App.tsx`, UI components, AI orchestration, PROJECT_STATE.md) touched.

## 2. Reproduction in worktree

- `npm run test:run` → 18 files, **175/175 passed** (baseline 163 + 12 new,
  zero regressions). Verified the main repo at baseline still shows 163/163,
  confirming the +12 delta comes from the new test file.
- `npm run build` → **succeeded** (tsc + vite, `✓ built in 939ms`).

## 3. Root-cause verification (code read, not just report)

The phase driver (`useGameState.ts` useEffect at ~line 157) previously had no
`DAY_VOTING` branch, so `finishVote` only fired from a human click — the
QA-observed soft-lock. The fix adds:

- Exported predicate `shouldAutoResolveVote(phase, me)` = `DAY_VOTING && !(me?.isAlive && me.canVote)`.
  This is the exact logical negation of `finishVote`'s own gate
  (`humanCanVote = Boolean(me?.isAlive && me.canVote)`, line 520), so
  auto-resolve fires precisely when `finishVote` would record the human as
  no-vote anyway. Consistent by construction.
- One `else if` branch inside the existing 700 ms driver timer, matching the
  seven existing phase branches.

Checks:

- **Vote tally untouched**: diff contains no changes to `finishVote` body,
  `resolveVoteResult`, `createVoteRecords`, or elimination/hunter/idiot
  handling. `finishVote(null)` is the same call the "NO VOTE" button already
  makes (`App.tsx:309`).
- **Living human**: predicate is false when `isAlive && canVote`; driver does
  nothing; the game still waits for the click. Acceptance criterion 2 holds.
- **Double-fire**: `finishVote` sets `isProcessingAI = true` as its first
  statement (line 517); the driver's top guard
  (`if (winner || !players.length || isProcessingAI) return;`) blocks re-runs,
  and the effect cleanup clears any pending timer on every re-run, so at most
  one timer exists and at most one `finishVote` fires per round. Effects run
  post-commit, so no stale-state window exists.
- **Race with dead spectator clicking "NO VOTE"**: `ActionBar.tsx:53` disables
  the button while `isProcessingAI`; timer callback and click handler are
  separate macrotasks, so whichever fires first commits the guard before the
  other runs. No new race introduced.
- **Stale `me` closure**: `me` derives from `players` (line 98) and `players`
  is in the effect deps, so the branch always sees the current value even
  though `me` itself is not listed.
- Predicate correctly covers the alive-but-vote-lost case (revealed Idiot),
  matching the card's fix direction `!me?.isAlive || !me.canVote`.

## 4. Tests

New file covers all card-required scenarios on both 9- and 12-player boards:
dead human → auto-resolve; living human → waits; revealed Idiot → auto-resolve;
never fires in any other phase; `me === undefined` defensive case; and a
driver-guard simulation proving at-most-once firing. The guard simulation is a
faithful transcription of the driver contract rather than a rendered hook (repo
has no renderHook/jsdom tooling — reasonable given existing test conventions in
`guestLobbyTransition.test.ts` / `integration.test.ts`).

## 5. Residual notes (non-blocking)

- The one-line React wiring (`else if ... finishVote(null)`) is covered by
  type-check/build and code inspection, not a rendered-hook test; a browser
  spot-check of a dead-human day-2 vote remains the strongest E2E evidence, as
  the coder also recommends.
- The "NO VOTE" button stays visible for ~700 ms before auto-resolve; clicking
  it early is safe (same call, mutually excluded). Cosmetic only; UI file was
  out of scope.

## Verdict

All acceptance criteria met: patch applies cleanly, scope respected, 175/175
tests pass (163 baseline + 12 new, zero regressions), build succeeds, root
cause fixed at the driver level with vote-tally semantics byte-for-byte
unchanged.

VERDICT: PASS
