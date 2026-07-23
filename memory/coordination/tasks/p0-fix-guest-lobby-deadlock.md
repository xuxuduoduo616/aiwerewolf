# Task: p0-fix-guest-lobby-deadlock

## Status

Superseded — covered by later accepted implementation; do not dispatch directly

## Objective

Fix root cause of Guest mode board selection freeze: after clicking "Guest Trial", users get stuck in a broken game view instead of entering the lobby. No "reload" workaround should be needed.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`

## Context

- **Root cause identified by coordinator**: In `src/App.tsx` line 96, the Guest Trial button calls `auth.handleGuest(rec.loadLocalRecords)` which sets `isGuest=true` but never calls `game.setPhase(GamePhase.LOBBY)`. The login UI hides (because `isAuthenticated = session || isGuest` becomes true), but `game.phase` remains `LOGIN`, falling through to the broken game view. The OTP handler on line 87 correctly calls `game.setPhase(GamePhase.LOBBY)` in its callback.
- **Scope boundary**: Only the phase transition after guest click. Do NOT refactor auth flow, routing, or game initialization.
- **Dependencies**: none.
- **Parallel wave**: May run concurrently with `p0-wolf-teammate-visual` (non-overlapping paths).

## Allowed changes

- `src/App.tsx` — add `game.setPhase(GamePhase.LOBBY)` after guest click
- `src/hooks/useAuth.ts` — optionally pass the phase setter or improve handleGuest callback
- Test files for regression coverage

## Do not change

- Unrelated code, credentials, deployment configuration, or other task cards.
- Game initialization logic in `useGameState.ts`
- Auth flow outside the guest entry path
- Git branches, commits, merges, rebases, worktree configuration.

## Acceptance criteria

1. New guest clicks "Guest Trial" → immediately enters lobby with board selection.
2. User with existing local guest records (localStorage) clicks "Guest Trial" → enters lobby.
3. User logs out and clicks "Guest Trial" → enters lobby.
4. No page refresh or "重新开始" click required.
5. Logged-in user's OTP flow still works correctly (no regression).
6. Automated test reproduces the old bug (phase stays LOGIN) and proves the fix.

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/p0-fix-guest-lobby-deadlock.md`
- Verdict: PASS/FAIL with reproduction steps and test results.
