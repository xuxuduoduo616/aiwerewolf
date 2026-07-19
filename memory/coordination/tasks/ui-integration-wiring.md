# Task: ui-integration-wiring

## Status

Accepted

## Objective

Wire all new UI components together: integrate GlobalShell + BottomNav + view switching into App.tsx, connect LobbyHome → MatchSelection navigation, hook MatchSelection board selection to existing startGame, ensure the existing game view renders correctly within the new shell, and run full test+verification.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `src/App.tsx` (full file — must understand current view structure)
- `src/hooks/useGameState.ts` (startGame, phase, etc.)
- `src/components/GlobalShell.tsx` (from ui-global-shell)
- `src/components/BottomNav.tsx` (from ui-global-shell)
- `src/components/LobbyHome.tsx` (from ui-lobby-home)
- `src/components/MatchSelection.tsx` (from ui-match-selection)
- `src/components/ProfileView.tsx` (from ui-profile-inventory)
- `src/types.ts`
- `index.css`

## Context

- Currently App.tsx has 4 render branches: restoring session, LOGIN, LOBBY, GAME
- New navigation: use a view state (in addition to GamePhase) to control which "tab" is active
- Bottom nav tabs control the top-level view: 首页 (lobby home), 好友 (placeholder), 狼村 (game/match selection), 商店街 (placeholder), 我的 (profile)
- The LOGIN view renders OUTSIDE the shell (full-screen)
- Once authenticated, all views render INSIDE the GlobalShell
- The existing GAME phase renders inside the shell too (game view preserved as-is)
- Match selection → selecting a board → calls startGame → transitions to GAME phase
- Lobby home → 建房 → navigates to match selection view

## Allowed changes

- `src/App.tsx` — restructure to wrap authenticated views in GlobalShell, add view routing logic, wire bottom nav callbacks
- `src/App.tsx` — preserve LOGIN screen as-is (outside shell)
- `src/App.tsx` — preserve GAME view JSX as-is (inside shell content area)
- `src/constants.ts` — add view enum/constants if helpful (do NOT modify existing constants)
- Any new component files needed for wiring (keep minimal — this is the glue card)
- `index.css` — minor integration fixes only if needed

## Do not change

- Game logic, game components (PlayerCard, ActionBar, SpeechInput, etc.), gameEngine, aiOrchestrator, useGameState
- Auth, Supabase, or deployment configuration
- Existing CSS classes' behavior

## Acceptance criteria

1. LOGIN view renders full-screen (no shell) — unchanged behavior
2. After login, all views render inside GlobalShell with BottomNav
3. Bottom nav 首页 tab → LobbyHome view
4. Bottom nav 狼村 tab → MatchSelection view
5. Bottom nav 我的 tab → ProfileView
6. Bottom nav 好友 and 商店街 → placeholder views
7. LobbyHome "建房" button → navigates to MatchSelection
8. MatchSelection board select → starts game via existing startGame → GAME view renders inside shell (game view preserved)
9. GAME view "返回大厅" button → returns to LobbyHome
10. GAME over → return to LobbyHome preserves the game flow
11. `npm run test:run` passes all existing tests (363+ tests, any regressions must be fixed)
12. `npm run build` succeeds

## Verification

```bash
npx tsc --noEmit
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/ui-integration-wiring.md`
- Worker must set this card to `Ready for review` or `Blocked`
- Critical: worker must verify existing tests still pass — this is the integration gate
