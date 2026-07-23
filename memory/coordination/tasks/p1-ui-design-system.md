# Task: p1-ui-design-system

## Status

Superseded — covered by later accepted implementation; do not dispatch directly

## Objective

Establish a unified design-system foundation in `index.css`: consistent design tokens (color, spacing, border, shadow, phase states), a `prefers-reduced-motion` guard for all animations, and accessibility improvements (focus-visible, contrast). Preserve the existing black/gray hand-drawn village aesthetic. Do NOT redesign into a neon lobby.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `index.css` (the whole file — it already has sketch-scene, moon, fog, trees, timers, etc.)

## Context

- `index.css` currently has scattered inline `rgba(...)` values repeated across many rules. There is NO `prefers-reduced-motion` support — the directive explicitly requires it (villageWind, treeSway, moonGlow, speakingPulse, timerPulse, and all keyframe animations run unconditionally).
- The aesthetic to PRESERVE: ink/charcoal black-gray, hand-drawn hatching, moon, fog, dashed seating ring. This is a 水墨/木刻 werewolf mood, not a neon game lobby.
- Scope boundary: This card touches ONLY `index.css`. It does NOT change any `.tsx` file. It introduces CSS custom properties (design tokens) and a reduced-motion media query. Component class usage stays the same — only the CSS definitions are refactored to use tokens.
- Dependencies: none.
- Parallel wave: MUST NOT run concurrently with `p1-ui-screen-polish` (both may touch index.css). This card runs FIRST, alone.

## Requirements

1. Add a `:root` block with CSS custom properties for the existing repeated values:
   - Ink color scale (the zinc/charcoal grays already in use)
   - Danger/wolf red scale
   - Border colors, shadow definitions, blur amounts
   - Spacing/radius scale if consistent values exist
2. Refactor existing rules to use these tokens WITHOUT changing the rendered result (visual parity — same colors, same look).
3. Add a `@media (prefers-reduced-motion: reduce)` block that disables or reduces: villageWind, treeSway, moonGlow, phase transitions, speakingPulse, timerPulse, voteStamp, roleReveal, logSlideIn, wolfChannelIn, game-over animations. Motion-triggered opacity/transform must settle to a static readable state.
4. Add `:focus-visible` outline styles for keyboard navigation on interactive elements (`.icon-button`, `.action-button`, `.mode-card`).
5. Do NOT add new external fonts or assets.
6. Do NOT change the visual appearance for users without reduced-motion preference (parity).

## Allowed changes

- `index.css` ONLY

## Do not change

- Any `.tsx` component file
- Any other CSS or config
- Game logic, tests unrelated to CSS
- Git branches, commits, worktree configuration.

## Acceptance criteria

1. `:root` design tokens defined and used in ≥6 existing rules.
2. `@media (prefers-reduced-motion: reduce)` disables all listed animations.
3. `:focus-visible` styles present for icon-button, action-button, mode-card.
4. Visual parity for default users (no color/layout change) — verify by building and screenshot comparison.
5. `npm run build` succeeds (CSS compiles, bundle not significantly larger).

## Verification

```bash
npm run build
npm run test:run
```

Then coordinator verifies visual parity via browser screenshot.

## Handoff

- Report path: `memory/coordination/reports/p1-ui-design-system.md`
- Verdict: PASS or FAIL.
