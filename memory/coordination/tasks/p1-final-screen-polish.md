# Task: p1-final-screen-polish

## Status

Superseded — covered by later accepted implementation; do not dispatch directly

## Objective

Polishing pass on three high-visibility surfaces: (1) auth/login panel — stronger moon/parchment theme, (2) role reveal — make the identity card reveal more dramatic yet restrained, (3) victory/defeat screen — richer visual payoff. Zero new dependencies, zero game-rule changes, CSS + minor TSX inline styling only.

## Required reading

- `src/App.tsx` — auth panel, lobby, role reveal in center-console, game-over rendering
- `index.css` — :root tokens, focus-visible, reduced-motion
- `src/components/PlayerCard.tsx` — role role-reveal class usage

## Context

- The design-system and screen-polish CSS cards are committed. :root tokens, reduced-motion, focus-visible, and .seat-stage.night/.player-dead/.player-selected classes exist.
- This card adds visual richness to three specific surfaces that currently feel bare:
  1. **Auth panel** (App.tsx lines 57-104): flat dark panel with a title. Moon crescent icon + parchment border would strengthen the werewolf theme.
  2. **Role reveal** (center-console lines 222-260): the `role-reveal` CSS animation class exists but isn't used. Revealing the player's identity could use a brief animation on first appearance.
  3. **Victory screen** (center-console lines 223-229): Trophy icon + text + "返回大厅" button. Could use a richer visual payoff (victory banner, faction-specific styling).
- Scope boundary: Small .tsx changes for inline class/style additions + CSS additions. Do NOT refactor the entire auth flow or game-over sequence.
- Dependencies: design-system + screen-polish CSS (committed).
- Parallel wave: runs ALONE (touches App.tsx and index.css — both shared surfaces).

## Requirements

### 1. Auth panel lunar/parchment theme

- Add a <Moon> icon (already imported from lucide-react) above the "AI WEREWOLF" heading, centered and slightly larger
- Optionally add a subtle parchment-texture CSS class for the auth-panel border (simulated via `border-image` or layered `box-shadow` in CSS)
- Keep all existing functionality (email input, OTP flow, Guest Trial)

### 2. Role reveal animation

- In the center-console during NIGHT_START: when the player's identity info card appears (lines 248-259), add a brief enter animation using the existing `role-reveal` CSS class
- The animation should complete quickly (~0.5s) and not block interaction
- Must be disabled in reduced-motion (the `role-reveal` entry in the reduced-motion block already does this — just wire the class)

### 3. Victory/defeat screen styling

- Wolf victory (狼人胜利): use more wolf-red styling (the `.game-over-wolves` class already has an animation — enhance with a subtle red background glow in the center-console)
- Village victory (好人胜利): add a subtle golden/amber glow
- Both: add a secondary detail line showing the game summary (round count, role name) from `game.roundCount` and `game.me?.role`
- Preserve the Trophy icon and "返回大厅" button

### 4. Log entry polish

- Add the `log-entry-in` CSS class (already defined but unused) to each log entry in the sidebar for a subtle slide-in animation

## Allowed changes

- `src/App.tsx` — small inline class/style additions for the surfaces above
- `index.css` — CSS additions for parchment texture, victory glow
- `src/components/VoteSummary.tsx` — small class additions (if log class wiring touches it)

## Do not change

- Game engine, state management, AI pipeline
- Auth flow logic, OTP, session management
- Board selection, difficulty selector
- Seat-stage rendering except for class additions
- Any deletion of existing UI elements

## Acceptance criteria

1. Auth panel shows Moon icon above heading, parchment-border visual.
2. Role reveal identity card has a brief enter animation.
3. Wolf victory screen has red styling; village victory has amber/golden styling.
4. Victory screen shows round count + role name below the result.
5. Log entries slide in with log-entry-in animation.
6. All new animations disabled in reduced-motion.
7. `npm run test:run` passes (55/55).
8. `npm run build` succeeds.

## Verification

```bash
npm run build
npm run test:run
```

## Handoff

- Report path: `memory/coordination/reports/p1-final-screen-polish.md`
- Verdict: PASS or FAIL.
