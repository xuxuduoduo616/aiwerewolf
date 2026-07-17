# Debugger Review: lobby-difficulty-i18n

**Role:** $aiwerewolf-debugger
**Date:** 2026-07-16
**Worktree:** /Users/frank/aiwerewolf-worktrees/lobby-difficulty-i18n

## Scope check

- `git diff` touches `src/types.ts` (+15) and `src/App.tsx` (+3/−3, lobby
  difficulty selector lines only: import line, button label at ~175,
  description at ~179). Untracked: `src/difficultyI18n.test.ts` (hidden by
  `.gitignore` `**/*.test.ts` — coordinator must `git add -f`) plus
  card/report copies.
- No out-of-scope files; no other part of `App.tsx` touched;
  `useGameState.ts`, `constants.ts`, `i18n/index.ts` untouched.

## Findings per criterion

1. **EN lobby shows Beginner/Intermediate/Expert + English descriptions; zh
   byte-identical** — PASS. `difficultyLabel`/`difficultyDescription` return
   the original `label`/`description` fields for `'zh'` (byte-identical) and
   `labelEn`/`descriptionEn` for `'en'`. `App.tsx` passes the existing
   `displayLanguage` state (already in scope at line 26 via
   `useDisplayLanguage()`), not a new state. EN descriptions match the card's
   suggested wording. zh default path: `language === 'en' ? en : zh`, so any
   non-'en' value falls back to zh — safe default.
2. **Additive interface change, consumers unaffected** — PASS.
   `DifficultyConfig` gains `labelEn`/`descriptionEn`; existing fields and all
   numeric parameters (`actionAccuracy` 0.45/0.72/0.92, `speechQuality`,
   `wolfCoordination`, `mistakeRate`) unchanged in the diff.
   `useGameState.ts:274` consumer compiles (build passes). No game-logic drift
   in `types.ts` — only interface fields, config strings, and two pure
   pickers appended.
3. **Unit tests** — PASS. 5 tests: non-empty EN fields (3 difficulties), exact
   zh/en label mapping, numeric `actionAccuracy` intact, picker returns zh
   fields for 'zh' and en fields for 'en' (3 × 2).
4. **Reproduced verification** — PASS.
   `npm run test:run`: 22 files, **236/236 passed** (baseline 231 + 5),
   matches coder claim. `npm run build`: succeeded (~1.0s).

## Notes

- Pickers typed with inline `'zh' | 'en'` instead of importing
  `DisplayLanguage` from `src/i18n` — reasonable: avoids a types.ts → i18n
  import cycle edge and stays assignment-compatible.
- `DIFFICULTY_LABELS` left untouched (zero consumers) — agree with coder's
  suggestion to consider a separate cleanup card; out of scope here.
- Integration reminder: `git add -f src/difficultyI18n.test.ts`.

VERDICT: PASS
