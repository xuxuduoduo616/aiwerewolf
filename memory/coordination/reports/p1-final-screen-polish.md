# Report: p1-final-screen-polish

## Summary

Polish pass on the four requested surfaces: auth panel lunar/parchment theme,
role-reveal animation wiring, faction-specific victory glow + game summary line,
and log-entry slide-in. TSX changes are class/attribute additions only; no game
logic, auth flow, or state management touched. No new dependencies.

## Changes

### `src/App.tsx`

1. **Auth panel** — added `<Moon className="w-10 h-10 mx-auto mb-3 opacity-40" />`
   centered above the "AI WEREWOLF" heading (Moon was already imported).
   Added `parchment-border` class to the `auth-panel` div.
2. **Role reveal** — identity card div (`你的身份` section in the center-console)
   now has `className="role-reveal mt-4 ..."` plus `key={`role-${game.phase}`}`
   so the card remounts and the existing 0.5s rotateY animation replays on
   phase change.
3. **Victory screen** — center-console div now conditionally appends
   `victory-wolves` / `victory-village` when `game.winner` is set. Added a
   secondary summary line below the title:
   `第{Math.max(1, game.roundCount)}轮结束 · {ROLE_LABELS[game.me.role]}`
   (role part guarded on `game.me`). Trophy icon and 返回大厅 button preserved.
4. **Log entries** — each sidebar log entry div now includes `log-entry-in`
   (keyed by `log.id`, unchanged), so new entries slide in on mount.

### `index.css`

1. `.parchment-border` — `border-color: var(--border-subtle)` plus layered
   box-shadow: `inset 0 0 30px rgba(161,130,80,0.06)` warm inner glow +
   `0 0 20px rgba(0,0,0,0.5)` outer dark. Placed after the `.auth-panel`
   shadow rule so it overrides it.
2. `.victory-wolves` — radial-gradient glow using the `--wolf-red-900` token
   over the center-console base tint `rgba(5,5,5,0.80)`.
3. `.victory-village` — subtle golden/amber radial-gradient glow over the same
   base tint.

## Reduced motion

- No new keyframes were added — all three new classes are static
  (border/box-shadow/background only), so no reduced-motion entries are needed.
- Verified `role-reveal` and `log-entry-in` are already neutralized in the
  existing `@media (prefers-reduced-motion: reduce)` block (`animation: none;
  opacity: 1; transform: none`), as are `game-over-wolves`/`game-over-village`.

## Verification

### `npm run test:run`

```
Test Files  10 passed (10)
     Tests  55 passed (55)
  Duration  417ms
```

### `npm run build`

```
tsc && vite build
✓ 1572 modules transformed.
dist/assets/index-C8I0EXFb.css    31.59 kB │ gzip:  7.17 kB
dist/assets/index-9Mir8Xuw.js    166.89 kB │ gzip: 51.97 kB
✓ built in 960ms
```

## Risks

- `key={`role-${game.phase}`}` remounts the identity card each phase change,
  replaying the 0.5s reveal per phase (as specified by the card). Reduced-motion
  users see no animation. Selected-player / witch info inside the card is
  derived from state, so the remount loses nothing.
- `.parchment-border` box-shadow intentionally supersedes the auth panel's
  previous `--shadow-panel` / Tailwind `shadow-[...]` values (later source
  order); visual-only.

## VERDICT: PASS
