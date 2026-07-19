# Task: ui-lobby-home

## Status

Accepted

## Objective

Rebuild the lobby/home screen as a mobile-game lobby: user profile panel, side menus, center character showcase, activity banner carousel, action buttons group, and lobby chat preview — all within the mobile shell.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `src/App.tsx` (existing LOBBY render block, component imports)
- `src/components/GlobalShell.tsx` (from ui-global-shell — read if exists, otherwise use placeholder interface)
- `src/components/BottomNav.tsx` (from ui-global-shell)
- `src/types.ts`
- `src/constants.ts`
- `index.css`

## Context

- The existing LOBBY view (lines 143-213 in App.tsx) shows board selection cards
- We need to build a NEW lobby home view with mobile-game lobby layout:
  1. Top-left user profile panel: circular avatar, level badge (Lv.10), nickname with gender icon, honor title (真相洞悉), rank badge (二阶 5星)
  2. Left sidebar: vertical icon buttons for 活动, 阵营应援, 限时娱乐 with red dot badges
  3. Right sidebar: vertical icon buttons for 功能菜单, 任务, 通行证, 首充
  4. Center character showcase area: large placeholder for character/skin art
  5. Bottom-center activity banner: scrollable/swipeable area showing season events (逐浪季限定, 线上海选赛)
  6. Bottom-right action buttons: 建房, 跟房, 观战 (3 semi-transparent matte buttons)
  7. Lobby chat preview box with 1-2 messages and unread dot
- The existing board selection UI should remain accessible (e.g., via 建房 → shows board grid)
- All icons use SVG placeholders (no external image dependencies)

## Allowed changes

- `src/App.tsx` — modify LOBBY render block to use new LobbyHome component (keep existing game logic hooks, just change the JSX)
- `src/components/LobbyHome.tsx` — new file: lobby view component
- `src/components/LobbySideMenus.tsx` — new file: left/right sidebar icon menus
- `src/components/LobbyActionButtons.tsx` — new file: 建房/跟房/观战 buttons + chat preview
- `src/components/ActivityBanner.tsx` — new file: scrolling activity banners
- `index.css` — add lobby-specific CSS classes (do NOT modify existing game CSS)

## Do not change

- Game logic in useGameState.ts, gameEngine.ts, aiOrchestrator.ts
- Existing game components (PlayerCard, ActionBar, SpeechInput, VoteSummary, WolfChannel, RecordsPanel, LogMessage)
- Types in src/types.ts (add new types if needed in a separate section)
- Existing .sketch-scene, .seat-stage CSS classes

## Acceptance criteria

1. Lobby home shows user profile panel with avatar placeholder, level Lv.10, nickname with gender icon, honor title, rank badge
2. Left and right sidebar icon menus render with SVG icons and red dot badges
3. Center character showcase area is visible and takes prominent space
4. Activity banner area shows at least 2 season event cards with horizontal scroll
5. 建房, 跟房, 观战 buttons are styled as semi-transparent matte buttons in the bottom-right area
6. Lobby chat preview box shows placeholder messages with unread dot
7. Existing board selection (GAME_MODES grid) is shown when 建房 is tapped (can be a simple modal or section toggle)
8. `npm run test:run` + `npm run build` succeed with no regressions
9. Component renders within the GlobalShell mobile viewport (import from ui-global-shell)

## Verification

```bash
npx tsc --noEmit
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/ui-lobby-home.md`
- Worker must set this card to `Ready for review` or `Blocked`
