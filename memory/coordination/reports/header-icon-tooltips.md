# header-icon-tooltips — Coder Report

**Status:** Ready for review
**Date:** 2026-07-16

## Changed files

- `src/App.tsx` (lines 221–222 only — in-game header buttons)

## What changed

Added `title` and `aria-label` attributes to both icon-only buttons in the
in-game header:

| Button | zh label | en label |
|--------|----------|----------|
| Mute toggle (Volume2/VolumeX) | `静音/取消静音` | `Mute / Unmute` |
| Return to lobby (RefreshCw) | `返回大厅` | `Return to lobby` |

Labels switch with the existing `displayLanguage` state already in scope
(lazy expression, no new state or effect). Pattern matches the lobby header
pill at line 146 which already uses `title` for the language toggle.

## What was NOT changed

- No behavioral, styling, or icon changes
- No in-game language pill reintroduced
- No other regions of `App.tsx` touched (SpeechInput, ActionBar, etc.)
- No new files, imports, or dependencies

## Verification

```bash
npm run test:run   # 25 files, 268 tests — all passed, zero regressions
npm run build      # tsc + vite production build succeeded, 0 errors
```

## Decisions

- Used inline ternary expressions for each label (two attribute values per
  button, 4 strings total) rather than extracting a helper — consistent with
  the existing `title` pattern at line 146 and avoids unnecessary abstraction
  for a two-button diff.
- Kept `title` and `aria-label` identical per button — they serve overlapping
  purposes (hover tooltip + screen reader announcement) and there is no value
  in diverging them for these simple actions.

## Residual risks

None. This is a purely additive attribute change with no logic, state, or
flow impact.

## Recommendation to coordinator

Accept. Patch is minimal (two lines changed, two attributes each), tests and
build pass cleanly. No conflict anticipated with the parallel `quick-speech-buttons`
card (different `App.tsx` region). Browser QA should confirm tooltip visibility
on hover in both zh and en modes.
