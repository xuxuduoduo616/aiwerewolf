# Review: quick-speech-buttons

## Verification

| Command | Result |
|---|---|
| `npm run test:run` | 26 files, 281 tests PASS (268 baseline + 13 new), zero regressions |
| `npm run build` | tsc + vite success, 1575 modules, zero errors |

## Diff analysis

3 files changed (114 insertions, 11 deletions), plus 1 new test file:

- `src/components/SpeechInput.tsx` (+111/-11): Added PRESETS data, `buildQuickSpeeches` / `applyQuickTemplate` pure helpers, `pendingTemplate` local state, 7-button preset row with tone-colored pills, pending-target hint, free-text input preserved below.
- `src/App.tsx` (+1): Added `selectedPlayer={game.selectedPlayer}` to the SpeechInput render block (line 310). No other App.tsx regions touched.
- `src/components/quickSpeech.test.ts` (new, 13 tests): 8 buildQuickSpeeches + 5 applyQuickTemplate, covering both languages, needsTarget flags, tone correctness, template substitutions.

## Acceptance criteria map

1. **Preset buttons during human speech turn**: PASS. Buttons render only when `visible` is true (gated on DAY_DISCUSSION + human speaker). 7 presets in the current display language render above the free-text input.

2. **Non-target click fills without auto-submit**: PASS. `handlePresetClick` calls `onChange(preset.text)` only; no `onSubmit` call. User can edit and send normally via existing button/Enter.

3. **Target preset with no target shows hint, applies on player tap**: PASS. `pendingTemplate` local state handles the arm-a-player flow. `useEffect` on `[selectedPlayer, pendingTemplate, onChange]` applies the template when a valid player is tapped. Hint text renders in zh/en. Human's own card (id 1) excluded as fill target. Pending state cleared on non-target click, successful application, and visibility change.

4. **Filled templates substitute seat number**: PASS. `applyQuickTemplate` replaces 'X' with `String(playerId)`. Tests cover single-digit and double-digit IDs.

5. **zh and en preset sets complete and correct**: PASS. Verified by test table comparison — 7 presets per language, exact texts match the card's table.

6. **Unit tests for both helpers**: PASS. 13 tests: buildQuickSpeeches (length, zh texts, en texts, needsTarget counts, X placeholder presence, tone positions, cross-language parity) + applyQuickTemplate (zh substitution, en substitution, all target presets, non-target no-op).

7. **Baseline + new tests pass**: PASS. 281/281 total (268 + 13), zero regressions.

8. **Build succeeds**: PASS.

9. **No App.tsx scope creep**: PASS. Only line 310 touched (SpeechInput render block). Header, seat stage, sidebar unchanged.

10. **Uses existing selectedPlayer, not new state**: PASS. `game.selectedPlayer` already exists in the hook; passed as prop. No `useGameState.ts` changes.

11. **Wave-1 SpeechInput placeholder i18n preserved**: PASS. `speechPlaceholder(language)` still used in the input placeholder; `useDisplayLanguage()` hook still imported; free-text input and send button unchanged.

12. **Tone-colored pills**: PASS. suspicion → red border/text, defend → emerald, neutral → zinc. `tone` tag stored in data for future role-based filtering.

## Residual notes

- The new test file `src/components/quickSpeech.test.ts` is gitignored by `.gitignore`'s `**/*.test.ts` rule. Coordinator must `git add -f` at integration.
- `useEffect` on `[selectedPlayer, pendingTemplate, onChange]` — `onChange` is `game.setUserInput` (React state setter, stable reference), no infinite loop risk.

VERDICT: PASS
