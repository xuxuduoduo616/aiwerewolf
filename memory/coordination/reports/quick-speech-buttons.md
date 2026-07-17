# Report: quick-speech-buttons

## Changed files

1. `src/components/SpeechInput.tsx` — added preset data, `buildQuickSpeeches` /
   `applyQuickTemplate` pure helpers, `pendingTemplate` state, preset button row
   with tone-colored pills, pending hint, and `selectedPlayer` prop.
2. `src/App.tsx` — added `selectedPlayer={game.selectedPlayer}` to the
   SpeechInput render block (line 310). No other App.tsx regions touched.
3. `src/components/quickSpeech.test.ts` — 13 pure-helper tests (new file,
   gitignored per `.gitignore` `**/*.test.ts`; coordinator must force-add at
   integration).

## Decisions

- **Pure helpers in SpeechInput.tsx**: `buildQuickSpeeches` and
  `applyQuickTemplate` are exported from the same file for colocation,
  matching the existing `speechPlaceholder` pattern. No new source files.
- **`selectedPlayer` type**: minimal `{ id: number; isAlive: boolean }` prop
  — avoids pulling the full `Player` type into SpeechInput when only two
  fields are needed.
- **Pending template lifecycle**: armed via `useState`; cleared on
  non-target clicks, on successful application, and on visibility change.
  Human's own card (id 1) is excluded as a fill target.
- **No `useGameState.ts` changes**: `selectedPlayer` already exists in the
  hook and is passed to SpeechInput via the existing prop chain — no hook
  changes were needed.
- **Tone coloring**: suspicion → red border/text, defend → emerald, neutral
  → zinc — visually distinct without being obtrusive on the dark theme.
- **`useDisplayLanguage()` hook** reused from wave-1 placeholder i18n card;
  language is fixed during a game, so re-renders on toggle are not a concern.

## Verification

| Command | Result |
|---|---|
| `npm run test:run` | 268 tests, 25 files, all PASS (baseline, zero regressions) |
| `npx vitest run src/components/quickSpeech.test.ts` | 13 tests, 1 file, all PASS (new tests: 8 buildQuickSpeeches + 5 applyQuickTemplate, both languages, needsTarget flags, tone correctness, all template substitutions) |
| `npm run build` | PASS (tsc + vite, 1575 modules, zero errors) |

The new test file is not picked up by `npm run test:run` because `.gitignore`
contains `**/*.test.ts` and vitest respects gitignore by default. The
coordinator must `git add -f` the test file at integration so it is tracked
and included in future runs. All tests pass when the file is invoked directly.

## Acceptance criteria map

1. Preset buttons during human speech turn — yes (visible only when
   `visible` prop is true, which gates on DAY_DISCUSSION + human speaker).
2. Non-target click fills without auto-submit — yes (`onChange` only).
3. Target preset with no target shows hint, applies on player tap —
   yes (`pendingTemplate` state + `useEffect` on `selectedPlayer`).
4. Filled templates substitute seat number — yes (`applyQuickTemplate` with
   `String(playerId)`, verified for 1-digit and 2-digit IDs).
5. zh and en sets complete and correct — verified by test table comparisons.
6. Unit tests for both helpers — 13 tests covering both languages, flags, tones.
7. Baseline + new tests pass — confirmed (268 + 13 = 281 total).
8. Build succeeds — confirmed.

## Residual risks

- **Pending template persistence across visibility toggles**: I added a
  `useEffect` that clears `pendingTemplate` when `visible` becomes false, so
  re-entering the speech phase starts clean.
- **Performance**: the 7-button row + hint add negligible DOM nodes; the
  `buildQuickSpeeches` call is a simple O(7) map on each render — trivial.
- **`useEffect` dependency on `onChange`**: `onChange` is `game.setUserInput`
  from the hook, which is a React state setter (stable reference) — no
  infinite loop risk.
- **Header region untouched**: only line 310 (SpeechInput render block) was
  modified in App.tsx — no conflict with the parallel `header-icon-tooltips`
  card.

## Recommendation

READY FOR REVIEW. Coordinator should:
1. `git add -f src/components/quickSpeech.test.ts` at integration so vitest
   picks it up in future `npm run test:run` runs.
2. Verify that the combined App.tsx patch (this card +
   `header-icon-tooltips`) doesn't conflict — the regions are disjoint (lines
   307–311 vs. header block), but sequential apply order should still be
   checked.
