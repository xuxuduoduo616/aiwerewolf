# Review: p1-ui-design-system

## Method

Read and verified the task card, coder report, and the full `index.css`. Ran
`npm run test:run` and `npm run build`. Checked git diff for .tsx contamination.
Inspected token definitions, var() usage, reduced-motion coverage, and
focus-visible styles manually.

## Requirement-by-requirement verification

### 1. :root block with CSS custom properties

**PASS.** Lines 9-35 define a complete `:root` block with:

- **Ink color scale** (raw RGB triples): `--ink-950`, `--ink-900`, `--ink-800`,
  `--ink-500`, `--ink-300`, `--ink-200`, `--ink-100`, plus `--ink-bright` as a
  full `rgb()` expression.
- **Wolf-red scale** (raw RGB triples): `--wolf-red-900`, `--wolf-red-600`,
  `--wolf-red-400`.
- **Border tokens**: `--border-subtle` (full rgba), `--border-strong` (full rgba).
- **Shadow tokens**: `--shadow-panel`, `--shadow-hover`.
- **Blur token**: `--blur-panel` (12px).

### 2. Rules referencing var(--...) tokens (>=6 required)

**PASS.** 22 total `var(--...)` references found. Distinct rule blocks consuming
tokens:

1. `.auth-panel/.mode-card/.center-console/.wolf-channel` — `var(--shadow-panel)`
2. `.mode-card` — `rgba(var(--ink-950), 0.74)`
3. `.mode-card:hover` — `var(--border-strong)`, `rgba(var(--ink-900), 0.86)`, `var(--shadow-hover)`
4. `.icon-button` — `var(--border-subtle)`, `rgba(var(--ink-950), 0.72)`, `rgb(var(--ink-200))`
5. `.icon-button:hover` — `rgba(var(--ink-800), 0.94)`, `rgba(var(--ink-100), 0.7)`
6. `.center-console` — `rgba(var(--ink-300), 0.28)`, `var(--blur-panel)`
7. `.timer-pill` — `rgba(var(--ink-100), 0.32)`, `rgba(var(--ink-100), 0.08)`, `rgb(var(--ink-100))`
8. `.timer-pill.urgent` — `rgba(var(--wolf-red-400), 0.6)`
9. `.action-button.danger` — `rgb(var(--wolf-red-900))`, `rgba(var(--wolf-red-400), 0.36)`
10. `.action-button.danger:hover:not(:disabled)` — `rgba(var(--wolf-red-600), 0.25)`
11. `.wolf-channel` — `rgba(var(--wolf-red-900), 0.6)`
12. `:focus-visible` group — `var(--ink-bright)`

This is well above the required 6.

### 3. prefers-reduced-motion: reduce media query

**PASS.** Lines 410-431. All animations from the requirements list are covered:

| Animation | Selector | Method |
|---|---|---|
| villageWind (fog) | `.sketch-scene::after` | `animation: none` |
| treeSway | `.sketch-tree::after` | `animation: none` |
| moonGlow | `.sketch-moon` | `animation: none` |
| phase transitions | `.phase-transition-night`, `.phase-transition-day` | `animation: none` |
| speakingPulse | `.speaking-ring` | `animation: none` |
| timerPulse | `.timer-pill.urgent` | `animation: none` |
| vote-stamp | `.vote-stamp` | `animation: none; opacity: 1; transform: none` |
| role-reveal | `.role-reveal` | `animation: none; opacity: 1; transform: none` |
| log-entry-in | `.log-entry-in` | `animation: none; opacity: 1; transform: none` |
| wolf-channel | `.wolf-channel` | `animation: none; opacity: 1; transform: none` |
| game-over (wolves) | `.game-over-wolves` | `animation: none; opacity: 1; transform: none` |
| game-over (village) | `.game-over-village` | `animation: none; opacity: 1; transform: none` |

The first six elements have stable base-state values (fog has `opacity: 0.38` in
its default rule, trees have their own transform, moon has its base box-shadow),
so `animation: none` alone is correct for them — they revert to their static
defaults.

The last six elements have animations that start from `opacity: 0` or involve
transforms — they correctly get `opacity: 1` and `transform: none` to settle to
a fully visible, static state.

### 4. :focus-visible outline styles

**PASS.** Lines 399-405:

```css
.icon-button:focus-visible,
.action-button:focus-visible,
.mode-card:focus-visible {
  outline: 2px solid var(--ink-bright);
  outline-offset: 2px;
}
```

All three interactive element types have a visible, high-contrast focus outline
for keyboard navigation. `outline-offset: 2px` prevents the outline from clipping
into the element border.

### 5. git diff — only index.css changed

**PASS.** Zero `.tsx` files appear in `git diff HEAD --name-only`. The diff does
show `.claude/skills/` files and `PROJECT_STATE.md` — these are pre-existing
coordinator changes present in the main worktree, not the coder's work. No
product code outside `index.css` was touched.

### 6. Visual parity / RGB token fidelity

**PASS.** The raw-RGB-triple pattern is consistently applied:

- `rgba(var(--ink-950), 0.74)` where `--ink-950: 9, 9, 11` produces `rgba(9, 9, 11, 0.74)` — byte-identical to the prior inlined literal.
- `rgba(var(--ink-900), 0.86)` where `--ink-900: 24, 24, 27` produces `rgba(24, 24, 27, 0.86)`.
- `rgb(var(--ink-200))` where `--ink-200: 228, 228, 231` produces `rgb(228, 228, 231)`.
- `rgba(var(--wolf-red-400), 0.6)` where `--wolf-red-400: 248, 113, 113` produces `rgba(248, 113, 113, 0.6)`.

The full-rgba tokens (`--border-subtle`, `--border-strong`) are used directly
with `var(...)` without wrapping, which is correct since they are complete
color expressions. The `--shadow-panel` and `--shadow-hover` tokens contain full
box-shadow values — also used directly. The blur token `--blur-panel: 12px` is
used in `blur(var(--blur-panel))` — correct.

No color values were altered. No layout properties were changed.

### 7. npm run test:run

**PASS.** 10 test files, 55/55 tests passed (422ms duration).

### 8. npm run build

**PASS.** TypeScript compilation and Vite production build succeeded (966ms).
CSS bundle: 30.37 kB (gzip 6.90 kB). No new build warnings.

## Edge cases and observations

- `--ink-500` is defined but unused. Not a defect — it completes the ink scale
  for future consumption. Same comment applies to `--ink-300` and `--ink-200`
  which have limited usage but are part of the scale.
- `.action-button.muted` (lines 315-319) retains inlined `rgba(...)` values
  without tokens. The task requires >=6 rules to use tokens, not 100% coverage,
  so this is acceptable.
- `.timer-pill.urgent` retains `color: rgb(252,165,165)` as an inline value
  (not covered by any token). This is a single-use light red distinct from the
  wolf-red scale — acceptable.
- The reduced-motion block groups selectors efficiently in two batches
  (animation-only vs animation+opacity+transform), which is clean and avoids
  repetition.
- No `.tsx` files, game logic, tests, or configuration were modified.

## Risks

None identified. The changes are strictly additive (token definitions) and
value-preserving (refactored rules produce identical rendered output). The
reduced-motion block is a pure addition. Focus-visible styles are additive.
The diff is scoped entirely to `index.css`.

VERDICT: PASS
