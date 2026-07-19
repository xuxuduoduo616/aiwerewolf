# Task: ui-global-shell

## Status

Accepted

## Objective

Create the global mobile-shell CSS design system and layout components: mobile viewport container, bottom navigation bar (5 tabs), top status bar with currency display and marquee, and the dark Chinese-style werewolf village aesthetic.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `index.css` (existing design tokens and CSS structure)
- `src/App.tsx` (current view structure)
- `src/types.ts` (existing types)

## Context

- The project currently has a desktop-first layout with sketch-scene background
- We need to add a mobile-first shell (max-width ~430px centered) that wraps all views
- Existing game views must continue to work inside this shell
- Styles must use existing CSS custom property tokens (--ink-*, --wolf-red-*, --border-*, --shadow-*) and extend them
- Bottom nav has 5 tabs: 首页, 好友, 狼村, 商店街, 我的 — these control view switching
- Top status bar: 3 currency types (金币/点卷/狼神水晶) with [+] buttons, marquee ticker below
- Dark Chinese-style werewolf village atmosphere with flat/mobile-game aesthetic

## Allowed changes

- `index.css` — add new CSS classes for mobile shell, bottom nav, top bar, marquee (do NOT modify existing game CSS classes)
- `src/components/GlobalShell.tsx` — new file: mobile viewport wrapper component
- `src/components/BottomNav.tsx` — new file: 5-tab bottom navigation
- `src/components/TopStatusBar.tsx` — new file: currency bar + marquee
- `src/constants.ts` — add new view enum/constants if needed

## Do not change

- Existing game CSS classes (.sketch-scene, .seat-stage, .center-console, .action-button, .icon-button, etc.)
- Any game logic files (gameEngine.ts, useGameState.ts, aiOrchestrator.ts, etc.)
- Existing component files
- `src/types.ts` game types
- Git configuration, deployment, or environment files

## Acceptance criteria

1. Mobile viewport container with max-width 430px, centered on desktop, dark background
2. Bottom navigation bar fixed at bottom with 5 tabs, each with SVG icon placeholder + label
3. Active tab visually highlighted
4. Top status bar: 3 currency displays side by side (金币/点卷/狼神水晶), each with [+] button
5. Marquee/跑马灯 text ticker below currency bar with scrolling animation
6. All new CSS uses existing design token variables where appropriate
7. `npm run build` succeeds (may have unused exports — that's OK, integration happens in later cards)
8. No changes to existing game behavior

## Verification

```bash
npx tsc --noEmit  # TypeScript compiles clean
npm run build      # Vite build succeeds
```

## Handoff

- Report path: `memory/coordination/reports/ui-global-shell.md`
- Worker must set this card to `Ready for review` or `Blocked`
- Changed files list + verification results in report
