# Review: phase-labels-i18n

## Verification

| Command | Result |
|---|---|
| `npm run test:run` | 26 files, 275 tests PASS (268 baseline + 7 new), zero regressions |
| `npm run build` | tsc + vite success, 1575 modules, zero errors |

## Diff analysis

4 files changed (24 insertions, 4 deletions), plus 1 new test file:

- `src/constants.ts` (+19): Added `PHASE_LABELS_EN` (12 entries, exact key parity with `PHASE_LABELS`), `getPhaseLabel()` helper (en → PHASE_LABELS_EN; zh → PHASE_LABELS; unmapped → raw key fallback), imported `DisplayLanguage` as type import.
- `src/hooks/useGameState.ts` (+1): Exposed `gameLanguage` in the hook return object (line 763). State already existed at line 125; now simply included in the returned object.
- `src/App.tsx` (+3/-3): Changed import from `PHASE_LABELS` to `getPhaseLabel`; replaced two `PHASE_LABELS[game.phase] || game.phase` expressions with `getPhaseLabel(game.phase, game.gameLanguage)` at line 216 (header phase line) and line 272 (center console).
- `src/phaseLabels.test.ts` (new, 7 tests): Key parity, non-empty labels, zh/en label retrieval, unmapped fallback, zh byte-identical verification.

## Acceptance criteria map

1. **EN game renders English labels; zh game byte-identical**: PASS. `getPhaseLabel(phase, 'en')` returns `PHASE_LABELS_EN[phase]`. `getPhaseLabel(phase, 'zh')` returns `PHASE_LABELS[phase]`, which are the original zh strings unchanged. The test explicitly verifies every `PHASE_LABELS` value is byte-identical.

2. **Labels come from gameLanguage, not displayLanguage**: PASS. Both `App.tsx` render sites use `game.gameLanguage` (from the hook return). `gameLanguage` is snapshotted at `startGame` via `resolveGameLanguage` — not the lobby `displayLanguage` state.

3. **Unmapped phases fall back to raw phase key**: PASS. `getPhaseLabel` returns `PHASE_LABELS_EN[phase] || phase` for en, `PHASE_LABELS[phase] || phase` for zh. Test covers `UNKNOWN_PHASE` fallback for both languages.

4. **New unit tests cover key parity and getPhaseLabel**: PASS. 7 tests: PHASE_LABELS_EN key parity (sorted comparison), non-empty EN labels, zh label retrieval for all keys, en label retrieval for all keys, unmapped fallback (zh), unmapped fallback (en), zh byte-identical verification.

5. **Baseline + new tests pass**: PASS. 275/275 total (268 + 7), zero regressions.

6. **Build succeeds**: PASS.

7. **Scope confined**: PASS.
   - `constants.ts`: `PHASE_LABELS` zh values untouched; `ROLE_LABELS`, `ROLE_DESCRIPTIONS` unchanged.
   - `useGameState.ts`: Only the return object touched (one line added). No game logic changes.
   - `App.tsx`: Only the two phase-label expressions + import line changed. No other regions touched.

## Residual notes

- `gameLanguage` was already fully wired through `startGame` → `resolveGameLanguage` and already used by AI calls (`generateWolfChat`, `handleDiscussion` speech generation). The change merely exposes it.
- Import style: `DisplayLanguage` imported as `type` import in constants.ts — consistent with the project's existing convention.

VERDICT: PASS
