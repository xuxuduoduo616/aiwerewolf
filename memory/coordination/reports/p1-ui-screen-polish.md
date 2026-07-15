# Report: p1-ui-screen-polish

**Date:** 2026-07-15
**Type:** Coder implementation
**Verdict:** PASS

## Changes

All changes are CSS-only in `index.css`. No `.tsx` files were touched.

### 1. `.seat-stage.night` — Phase differentiation (lines 247-252)

Added a `.seat-stage.night` class that overrides the base `seat-stage` background with a deeper, cooler-toned radial gradient. The center uses `rgba(14,14,26,0.84)` with a `rgba(180,200,255,0.025)` blue tint in the linear-gradient layer, while the outer ring fades to `rgba(0,0,8,0.28)`. The `::before` (dashed ring) and `::after` (vignette) pseudo-elements are preserved from the base `.seat-stage`. The default `.seat-stage` without `.night` remains the day state.

### 2. `.player-dead` — Death state refinement (lines 333-352)

Replaced the filter-only approach with a structured CSS class:
- `.player-dead`: sets `position: relative` and `opacity: 0.55` for reduced visibility while maintaining legibility
- `.player-dead::before`: applies a diagonal crosshatch overlay via `repeating-linear-gradient(-45deg)` using ink-tone `rgba(161,161,170,0.14)` at 3-4px spacing, creating a werewolf-themed "crossed out" visual

### 3. `.player-selected` — Selection ring refinement (lines 354-358)

Added a CSS override class to tone down the selection glow:
- `border-width: 2px !important` (thicker border)
- `box-shadow: 0 0 12px rgba(212,212,216,0.18) !important` (alpha reduced from 0.35 to 0.18)
- `!important` ensures this overrides Tailwind's inline-like precedence without TSX changes

### 4. `.action-button.danger::after` — Danger confirmation hint (lines 322-326)

Added a subtle "确认?" text appended via `::after` pseudo-element on danger action buttons:
- `content: " 确认?"`
- `font-size: 10px; opacity: 0.7`

### 5. `.speaking-ring.night` — Night speaking ring variant (lines 389-396)

Added a cooler-tone speaking pulse variant:
- `.speaking-ring.night`: uses `speakingPulseNight` keyframes with `rgba(180,200,255,0.35)` instead of the day warm-white `rgba(244,244,245,0.5)`
- New `@keyframes speakingPulseNight` defined with blue-tinted glow

### 6. Reduced-motion block extended (lines 480-481)

Added to the `@media (prefers-reduced-motion: reduce)` block:
- `.speaking-ring.night { animation: none; }` — disables the night pulse animation
- `.player-dead::before { /* static crosshatch — no animation */ }` — included for completeness (the gradient is already static)

## Build output

```
vite v5.4.21 building for production...
✓ 1572 modules transformed.
✓ built in 955ms
```

All chunks generated successfully. No warnings.

## Test output

```
 Test Files  10 passed (10)
      Tests  55 passed (55)
```

Zero regressions. All 55 tests pass.

## Acceptance criteria check

1. `.seat-stage.night` CSS class exists and creates a visibly different (darker/cooler) background — PASS
2. `.player-dead` CSS class provides a crosshatch/stamp overlay — PASS
3. Selection ring glow is less harsh than current 0.35 alpha — PASS (0.18 alpha, 2px border)
4. Danger button has a `::after` confirmation hint — PASS
5. `npm run build` succeeds — PASS
6. `npm run test:run` passes (55/55) — PASS

## Unchanged

- `:root` token definitions (used, not changed)
- `reduced-motion` block structure (extended, not removed)
- All `.tsx` files
- Game logic, tests

## Risks

None. Pure CSS additions that are opt-in via class selectors — no element receives these classes from the TSX yet, so zero visual impact on the running application. The classes are ready for wiring in a future coordinator integration card.

## Files changed

- `index.css` — 5 insertion points, approximately 45 new lines
