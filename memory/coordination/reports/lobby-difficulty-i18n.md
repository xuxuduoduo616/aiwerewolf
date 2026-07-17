# Worker Report: lobby-difficulty-i18n

**Date:** 2026-07-16
**Role:** $aiwerewolf-coder
**Status:** Ready for review

## Summary

Added English labels/descriptions to the three difficulty configs and made the
lobby difficulty selector render in the current display language, per audit
issue A03. Additive change only; zh rendering is byte-identical.

## Changed files

- `src/types.ts` — `DifficultyConfig` gains `labelEn: string` and
  `descriptionEn: string` (additive, existing `label`/`description` and all
  numeric parameters untouched). All three `DIFFICULTY_CONFIGS` entries filled
  (新手→Beginner, 进阶→Intermediate, 高手→Expert; descriptions use the card's
  suggested English wording). Added two pure pickers exported for testability:
  `difficultyLabel(config, language)` and `difficultyDescription(config, language)`
  with `language: 'zh' | 'en'`.
- `src/App.tsx` — lobby difficulty selector only (import line + lines ~175/179):
  button labels use `difficultyLabel(DIFFICULTY_CONFIGS[d], displayLanguage)`;
  the description paragraph uses
  `difficultyDescription(DIFFICULTY_CONFIGS[game.difficulty], displayLanguage)`.
  `displayLanguage` was already in scope (line 26). No other part of App.tsx
  touched.
- `src/difficultyI18n.test.ts` — NEW, 5 tests, node env, pure-helper pattern
  (no jsdom/@testing-library): non-empty `labelEn`/`descriptionEn` for all
  three difficulties; exact zh/en label mapping; numeric `actionAccuracy`
  values intact; picker returns zh fields for 'zh' and en fields for 'en'
  (3 difficulties × 2 languages).

## Decisions

- Pickers take `language: 'zh' | 'en'` inline instead of importing
  `DisplayLanguage` from `src/i18n` — avoids a types.ts → i18n import edge
  (i18n already imports from types.ts) while staying assignment-compatible
  with `DisplayLanguage`.
- `DIFFICULTY_LABELS` left untouched: grep shows it has zero consumers, and the
  lobby only reads `DIFFICULTY_CONFIGS`. Adding an EN variant there would be
  dead code; deleting it is out of scope. Flagging as possible cleanup for the
  coordinator.
- Note for coordinator: the task card was NOT present in the worktree's
  `memory/coordination/tasks/` at dispatch; I copied it verbatim from the main
  repo (read-only access) so the worktree handoff is self-contained. It shows
  as untracked in `git status`.

## Verification

```
npm run test:run  → 22 test files, 236/236 passed (baseline 231 + 5 new), zero regressions
npm run build     → success (tsc + vite), no new warnings
```

## Acceptance criteria check

1. EN lobby shows Beginner/Intermediate/Expert + English description; zh path
   returns the exact original `label`/`description` strings (byte-identical) — ✅
   (unit-tested via pickers; browser pass left to debugger/QA).
2. `DifficultyConfig` extended additively; `useGameState.ts:274`
   (`actionAccuracy`) untouched and compiles — ✅
3. Label mapping 3×2 + non-empty EN descriptions tested — ✅
4. 236/236 tests pass — ✅
5. Build succeeds — ✅

## Residual risks

- None significant. Change is additive data + display-layer pick; no game
  logic touched. EN description strings are static (reviewable in diff).
- Browser-visual confirmation of the EN lobby was not performed here
  (repo convention: no jsdom; recommend debugger spot-checks in browser QA).

## Recommendation

Accept after debugger review. Optional follow-up card: remove unused
`DIFFICULTY_LABELS` from `src/types.ts` (zero consumers).
