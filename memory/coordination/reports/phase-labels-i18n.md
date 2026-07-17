# Report: phase-labels-i18n

## Status

Ready for review

## Changed files

- `src/constants.ts` — added `PHASE_LABELS_EN`, `getPhaseLabel()` helper, imported `DisplayLanguage` type
- `src/hooks/useGameState.ts` — exposed `gameLanguage` in the return object (was only internal state)
- `src/App.tsx` — replaced two `PHASE_LABELS[game.phase] || game.phase` sites with `getPhaseLabel(game.phase, game.gameLanguage)`, updated import line
- `src/phaseLabels.test.ts` — new test file (7 tests)

## Verification

| Command | Result |
|---|---|
| `npm run test:run` | 26 test files, **275 tests passed** (268 baseline + 7 new), zero regressions |
| `npm run build` | Succeeded in 1.02s, zero errors, zero warnings |

## Decisions

- **getPhaseLabel fallback**: mirrors the existing `|| game.phase` pattern — unmapped phase keys return the raw key string in both languages. No new domain types needed.
- **PHASE_LABELS_EN keys**: exactly match `PHASE_LABELS` keys. The test enforces key parity.
- **EN label wording**: used the card's suggested labels with minor adjustments for consistency (e.g., "Seer Checks" not "Seer Check").
- **Import style**: `PHASE_LABELS` removed from App.tsx import (unused after the change); `getPhaseLabel` added in its place. `DisplayLanguage` imported as `type` import in constants.ts to match the project's existing `type` import convention.

## Residual risks

- None. The change is purely additive to constants.ts, one-line additive to useGameState.ts, and a two-site expression swap in App.tsx. `gameLanguage` was already fully wired through `startGame` → `resolveGameLanguage` and used by AI calls — it is now simply exposed.

## Recommendation

Accept. Ready for integration.
