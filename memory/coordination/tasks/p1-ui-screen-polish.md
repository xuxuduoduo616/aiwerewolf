# Task: p1-ui-screen-polish

## Status

Queued

## Objective

Layer screen-phase polish on the existing CSS design-system foundation: add night/day phase visual differentiation on the seat-stage, strengthen information hierarchy (alive/dead, selected, speaking), and add danger-action confirmation styling. Preserve the existing ink/wolf-red tokens, reduced-motion preferences, and focus-visible a11y from the design-system card.

## Required reading

- `index.css` — the complete file, especially `:root` tokens, seat-stage, center-console, speaking-ring
- `src/App.tsx` — to understand which classes/phase states are rendered

## Context

- The design-system card (already committed) added `:root` tokens, `prefers-reduced-motion`, and `:focus-visible`. This card builds ON TOP of that foundation.
- Current weaknesses:
  1. **Night/day phase not visually distinct** in the seat-stage background. Only the center-console text changes; the background circle, dashes, and vignette look identical whether it's night or day.
  2. **Dead players** are `opacity: 0.6 grayscale brightness-[0.5]` which feels like a CSS filter dump, not an intentional ink-style "crossed-out/marked" treatment.
  3. **Selected player** uses a bright white border and glow — too harsh for the ink aesthetic.
  4. No **phase transition** class is actually applied to `.seat-stage` in the TSX (we're CSS-only here, but the CSS classes must exist so they CAN be applied later).
- Scope boundary: CSS-ONLY. Zero `.tsx` changes. The goal is to add CSS phase classes and refine existing styles so the next card (or a future coordinator integration) can wire them up.
- Dependencies: `p1-ui-design-system` (already committed — `:root` tokens available).
- Parallel wave: Could run concurrently with P1 global UI polish if paths don't overlap, but since both touch index.css, this runs ALONE.

## Requirements

1. **Phase-differentiation CSS classes**: Add `.seat-stage.night` and `.seat-stage.day` variants:
   - `.night`: deeper background (darker radial gradient center), blue-tinted vignette (hue-rotate to cool tones)
   - `.day`: current default look (no change from now — this should be the base state)
   - Both must respect the `:root` tokens and ink palette — no bright colors

2. **Death state refinement**: Refine the `.opacity-60.grayscale.brightness-[0.5]` Tailwind classes with a new `.player-dead` class that provides:
   - A subtle diagonal crosshatch or stamped overlay (using CSS `repeating-linear-gradient`)
   - Preserves readability (the player number and name must remain legible)
   - Works within the existing PlayerCard structure (just CSS, no JSX changes)

3. **Selection ring refinement**: Tone down the selection glow from `rgba(244,244,245,0.35)` to a more restrained `rgba(212,212,216,0.18)` with a slightly thicker border. Use a new `.player-selected` selector if the current Tailwind class chain can't be targeted cleanly.

4. **Danger-action hover**: Add a subtle "确认?" tip via `::after` pseudo-element on `.action-button.danger` to indicate irreversible actions.

5. **Speaking state**: The current `speaking-ring` animation is good. Add a `speaking-ring` companion for night-speaking (slightly cooler glow tone via a CSS variable or class override).

6. **Reduced-motion**: All new animations/pseudo-elements must be disabled in the existing `@media (prefers-reduced-motion: reduce)` block if they add motion.

## Allowed changes

- `index.css` ONLY

## Do not change

- Any `.tsx` file
- `:root` token definitions (use them, don't change them)
- The `reduced-motion` block structure (extend it, don't remove rules)
- Game logic, tests

## Acceptance criteria

1. `.seat-stage.night` CSS class exists and creates a visibly different (darker/cooler) background.
2. `.player-dead` CSS class provides a crosshatch/stamp overlay.
3. Selection ring glow is less harsh than current `0.35` alpha.
4. Danger button has a `::after` confirmation hint.
5. `npm run build` succeeds.
6. `npm run test:run` passes (55/55 — no regressions).

## Verification

```bash
npm run build
npm run test:run
```

## Handoff

- Report path: `memory/coordination/reports/p1-ui-screen-polish.md`
- Verdict: PASS or FAIL.
