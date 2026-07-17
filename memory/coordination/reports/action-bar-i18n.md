# Report: action-bar-i18n

**Status:** Ready for review
**Date:** 2026-07-16

## Changed files

- `src/components/ActionBar.tsx` — modified (34 insertions, 8 deletions)
- `src/components/ActionBar.test.ts` — new test file

## What was done

- Added exported `ActionLabelKey` type, `ACTION_LABELS` table (owner-specified
  zh/en labels from the card), and pure helper
  `export const actionLabel = (key: ActionLabelKey, language: DisplayLanguage): string`
  to `ActionBar.tsx`.
- ActionBar reads the language via the existing `useDisplayLanguage()` hook
  from `src/i18n` (per card — no `App.tsx` prop change) and renders all eight
  button labels through `actionLabel(...)`: KILL/刀人, CHECK/查验, SAVE/救人,
  POISON/毒药, PASS/跳过, SHOOT/开枪, VOTE/投票, NO VOTE/弃票.
- Text labels only: icons, disabled conditions, click handlers, CSS classes,
  and the props contract are byte-identical to before.
- New node-env unit tests (no jsdom/@testing-library, mirroring
  `PlayerCard.wolfvision.test.ts` conventions): table-driven `it.each` over all
  8 keys × both languages (16 assertions) plus a key-count guard — 17 tests.

## Decisions

- Key `NO_VOTE` (underscore) used for the "NO VOTE" label so keys are valid
  identifiers; the rendered en string remains exactly `NO VOTE`.
- Label table lives in `ActionBar.tsx` (not `src/i18n/index.ts`) because
  `src/i18n/index.ts` is in the card's "Do not change" list.
- The test imports `actionLabel` directly from `./ActionBar` (the .tsx module);
  module import runs no hooks, so node env is fine.

## Verification (actual results)

```
npm run test:run  → Test Files 22 passed (22), Tests 248 passed (248)
                    = baseline 231 + 17 new, zero regressions
npm run build     → ✓ built in 1.05s (TypeScript + Vite succeeded)
```

## Residual risks / integration notes

1. **Gitignored test file:** `.gitignore` line 24 (`**/*.test.ts`, Netlify
   deployment exclusion) covers the new `src/components/ActionBar.test.ts`.
   Existing test files (e.g. `PlayerCard.wolfvision.test.ts`) are tracked, so
   the convention is to force-add: the coordinator must `git add -f
   src/components/ActionBar.test.ts` during integration or the test will be
   silently dropped from the patch.
2. **Dispatcher gap:** the card `action-bar-i18n.md` was NOT copied into this
   worktree by the dispatcher; I copied it read-only from the main repo's
   `memory/coordination/tasks/` before starting. Worth checking the dispatch
   script so other wave-1 workers aren't missing their cards.
3. Language correctness relies on the cycle-5 invariant that display language
   cannot change mid-game (lobby is the sole authority). If that invariant is
   ever relaxed, ActionBar will follow the toggle live — which would still be
   correct behavior, so risk is negligible.

## Recommendation

Accept. Minimal diff, all acceptance criteria met, zero regressions. Remind
integration step about `git add -f` for the new test file (note 1).
