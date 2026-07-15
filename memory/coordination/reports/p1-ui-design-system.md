# Report: p1-ui-design-system

## Summary

CSS-only design-system foundation added to `index.css`. Introduced a `:root`
design-token block, refactored existing rules to consume tokens (visual parity
preserved), added a `prefers-reduced-motion` guard covering all animations, and
added `:focus-visible` outlines for keyboard navigation. No `.tsx`, config, or
dependency changes.

## Design tokens (`:root`)

Colors stored as raw RGB channel triplets so any alpha can be applied via
`rgba(var(--token), a)` — values mirror the previously inlined literals exactly.

- Ink scale: `--ink-950` (9,9,11), `--ink-900` (24,24,27), `--ink-800` (39,39,42),
  `--ink-500` (113,113,122), `--ink-300` (212,212,216), `--ink-200` (228,228,231),
  `--ink-100` (244,244,245), `--ink-bright` (rgb(244,244,245))
- Wolf-red scale: `--wolf-red-900` (127,29,29), `--wolf-red-600` (220,38,38),
  `--wolf-red-400` (248,113,113)
- Borders: `--border-subtle` (rgba(113,113,122,0.35)),
  `--border-strong` (rgba(244,244,245,0.72))
- Shadows: `--shadow-panel`, `--shadow-hover`
- Blur: `--blur-panel` (12px)

## Refactored rules (7, ≥6 required — all identical rendered output)

1. `.auth-panel/.mode-card/.center-console/.wolf-channel` shared shadow → `var(--shadow-panel)`
2. `.mode-card` + `.mode-card:hover` → ink-950 bg, `--border-strong`, ink-900 hover, `--shadow-hover`
3. `.icon-button` + `:hover` → `--border-subtle`, ink-950/800 bg, ink-200/100 color
4. `.center-console` → ink-300 border, `--blur-panel`
5. `.timer-pill` + `.timer-pill.urgent` → ink-100 border/bg/color, wolf-red-400 border
6. `.action-button.danger` + `:hover` → wolf-red-900 bg, wolf-red-400 border, wolf-red-600 shadow
7. `.wolf-channel` → wolf-red-900 border

## Reduced-motion coverage (`@media (prefers-reduced-motion: reduce)`)

Animation disabled on: `.sketch-scene::after` (fog/villageWind),
`.sketch-tree::after` (treeSway), `.sketch-moon` (moonGlow),
`.phase-transition-night/day`, `.speaking-ring` (speakingPulse),
`.timer-pill.urgent` (timerPulse). Group with `animation:none; opacity:1;
transform:none;` (settles mid-keyframe states): `.vote-stamp`, `.role-reveal`,
`.log-entry-in`, `.wolf-channel`, `.game-over-wolves`, `.game-over-village`.

## Focus-visible additions

`.icon-button`, `.action-button`, `.mode-card` `:focus-visible` →
`outline: 2px solid var(--ink-bright); outline-offset: 2px;`

## Verification

- `npm run build`: success, built in 1.04s. CSS bundle 30.37 kB (gzip 6.90 kB),
  no significant size change.
- `npm run test:run`: 10 files, 55/55 passed.

Visual parity: token values are byte-equivalent to prior literals; default
(non-reduced-motion) users see an identical result. Coordinator to confirm via
browser screenshot.

## Risks

None. Tokens are additive; refactors are value-preserving substitutions.

VERDICT: PASS
