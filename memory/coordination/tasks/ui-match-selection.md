# Task: ui-match-selection

## Status

Accepted

## Objective

Build the match/board selection view (快速游戏/匹配选择板子): top return/help buttons, 4 sub-tabs (首页/新手场/娱乐场/进阶场), wide card stack layout for open boards, 2-column grid layout for limited-time boards, and multi-match button.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `src/App.tsx` (LOBBY → GAME_MODE grid, board selection logic)
- `src/constants.ts` (GAME_MODES, Role, ROLE_LABELS)
- `src/types.ts` (GameConfig)
- `index.css`

## Context

- Existing board selection is a simple 2-column grid of GAME_MODES cards
- New match selection view replaces/extends this with a mobile-game board browser:
  1. Top bar: back button (←) and help (?) button
  2. Sub-tabs: 首页, 新手场, 娱乐场, 进阶场
  3. Wide card stack (常驻开放场): vertical list of wide cards showing:
     - Card left: board name + one-line description
     - Card bottom-left: role icon mini badges with count (4狼, 4民, 预, 女, 猎, 白)
     - Card right: character bust illustration placeholder
     - Card bottom-right: season label (逐浪季)
     - Bottom: large yellow 多选匹配 button
  4. Grid columns (限时活动场): 2-column grid cards with:
     - Board name, config thumbnails, countdown text (剩余3天10小时)
- The existing startGame function must still work when a board is selected
- Game modes from GAME_MODES constant should populate the wide card list

## Allowed changes

- `src/App.tsx` — wire match selection view into the navigation (toggle between lobby home and match selection)
- `src/components/MatchSelection.tsx` — new file: main match selection view
- `src/components/MatchWideCard.tsx` — new file: wide card stack item
- `src/components/MatchGridCard.tsx` — new file: 2-column grid card item
- `src/components/MatchSubTabs.tsx` — new file: sub-tab bar
- `index.css` — add match-selection-specific CSS (do NOT modify existing game CSS)

## Do not change

- Game logic, types (except adding new types if needed in a non-breaking way), constants
- Existing game components
- useGameState hook

## Acceptance criteria

1. Match selection view has back (←) and help (?) buttons in top bar
2. 4 sub-tabs (首页/新手场/娱乐场/进阶场) render and are clickable
3. Wide card stack shows at least 2 board cards with role badges, descriptions, character placeholder art, and season labels
4. Each wide card is clickable and triggers game start via the existing startGame flow
5. Grid layout shows 2-column cards with countdown text and season labels
6. Large yellow 多选匹配 button renders at bottom of wide card section
7. Back button returns to lobby home
8. `npm run test:run` + `npm run build` succeed

## Verification

```bash
npx tsc --noEmit
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/ui-match-selection.md`
- Worker must set this card to `Ready for review` or `Blocked`
