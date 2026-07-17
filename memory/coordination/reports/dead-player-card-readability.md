# Report: dead-player-card-readability

**Date:** 2026-07-16
**Worker:** aiwerewolf-coder
**Status:** Ready for review

## Changed files

- `src/components/PlayerCard.tsx` — line 59 only.

## Change

Dead-player card classes changed from
`opacity-60 grayscale brightness-[0.5] border-zinc-800` to
`opacity-75 brightness-[0.65] border-zinc-800` (owner-specified values;
`grayscale` dropped, `border-zinc-800` retained). Skull overlay, OUT label,
badges, alive/selected/speaking styles, props, and logic are untouched.

## Before / after note (audit V01)

- Before: combined `opacity-60` + `brightness-[0.5]` reduced text contrast to
  roughly 30% of alive-card luminance on the `bg-zinc-900/78`-on-zinc-950
  board; name, seat number, and role badge were near-illegible, only the red
  OUT label survived.
- After: `opacity-75` + `brightness-[0.65]` yields roughly 49% effective
  luminance — name and seat number remain legible while the dimming plus the
  skull overlay and OUT label still clearly read as "dead". Removing
  `grayscale` also preserves the red OUT/skull accents.
- Visual browser confirmation is deferred to the debugger/coordinator QA pass
  per the card (repo has no DOM tests; no unit test added for a Tailwind class
  literal).

## Decisions

- Exact owner-specified replacement applied; no other interpretation needed.
- The task card was missing from the worktree copy of
  `memory/coordination/tasks/`; it was copied in from the main repo card
  (read-only source) so status could be tracked per handoff protocol.

## Verification

```
npm run test:run  → 21 test files, 231/231 passed (baseline 231, zero regressions)
npm run build     → succeeded (Vite production build, ~1s)
```

## Residual risks

- Purely visual change; legibility judgment above is analytical
  (opacity x brightness math), not yet browser-verified. Debugger should
  confirm dead-card name/seat legibility in the browser QA pass.

## Recommendation

Accept after visual confirmation in browser QA. One-line diff, zero test or
build impact.
