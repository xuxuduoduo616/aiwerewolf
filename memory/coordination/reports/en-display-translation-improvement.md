# Report: en-display-translation-improvement

## Status

Ready for review

## Summary

In EN display mode, speech logs whose `message` field is a known canned
fallback stub from `aiOrchestrator` (or missing) while a `translation` (zh
original) exists now translate the zh original through `translateLogText`
instead of showing the stub. Pending/failed/local-dev states show the zh
original (never the stub), and the existing "Show original" toggle switches
between the translated English and the zh original. All existing translation
semantics (per-log-id cache, in-flight dedup, failure fallback, local Vite
guard) are reused unchanged.

## Changed files

- `src/i18n/index.ts` — added `isCannedEnglishStub` (anchored exact-match
  regexes for the four known stubs: `Speaks based on game situation.`,
  `Frames Player <N|?>.`, `Pushes suspicion on Player <N|?>.`,
  `Seer reports: Player <N> is GOOD|WOLF.`) and
  `pickTranslationSource(log, language)` which returns the zh original as the
  translation source only when `language === 'en'`, the log is not a system
  entry, a zh original exists, and `message` is missing or a stub; otherwise
  falls through to `pickLogText`.
- `src/components/LogMessage.tsx` — swapped `pickLogText` for
  `pickTranslationSource` as the rendered/translated base text (single-line
  logic change plus doc comment). The existing effect, cache flow, and toggle
  are untouched, so the zh original is displayed until translation arrives and
  the toggle flips translation ↔ zh original.
- `src/i18n/i18n.test.ts` — 9 new tests: stub detection positives (all four
  stubs incl. `?` player id and the Seer GOOD/WOLF variants) and negatives
  (genuine English incl. `Seer reports: Player 4 is probably GOOD, trust me.`
  and a `Pushes suspicion on Player 3 because ...` superset string),
  zh-original substitution for stub/missing `message` (incl. a dedicated Seer
  stub routing case), genuine-English pass-through, no-translation guard,
  system-message guard, and zh-mode equivalence with `pickLogText`.
- `src/services/translationService.test.ts` — 5 new tests mirroring the
  LogMessage EN stub path (`pickTranslationSource` + `translateLogText`):
  stub replaced by translation on success (asserts zh original is the prompt
  source), failure falls back to zh original, local Vite dev shows zh original
  without fetching, genuine English never fetches, per-log-id cache dedup
  preserved on the stub path.

## Verification

- `npm run test:run` — 17 files, **177/177 passed** (baseline 163 + 14 new,
  zero regressions).
- `npm run build` — TypeScript + Vite production build succeeded.

## Decisions

- Stub detection lives in `src/i18n/index.ts` next to `pickLogText` (bilingual
  field semantics belong to the display layer); `translationService.ts` is
  untouched, keeping its cache/fallback semantics exactly as before.
- **Debugger fix**: the Seer fallback `Seer reports: Player N is GOOD/WOLF.`
  (aiOrchestrator:295) was initially excluded (it carries the check result)
  but is now included per debugger verdict — the zh field at :296 carries the
  real speech, so the terse English line is a stub like the others. The regex
  is anchored to the exact `GOOD|WOLF` pattern so genuine Seer speeches
  (any extra wording) never match.
- The missing-`message` case is included in `pickTranslationSource` for
  explicitness even though `pickLogText` already falls back to the zh field
  there — both paths yield the same source.
- No React-render test was added: the repo has no jsdom/@testing-library
  setup, and the existing convention (e.g. `computeVoteSummary`) is to test
  exported pure logic. The new tests exercise the exact source-selection +
  translation composition LogMessage runs.

## Residual risks

- If aiOrchestrator ever changes or adds stub strings, the exact-match list
  must be updated in lockstep (kept deliberately narrow per the card to avoid
  false positives on genuine English speech).
- On translation failure the toggle does not appear (the zh original is shown
  directly) — consistent with the existing behavior for failed ja→zh
  translations.

## Recommendation

Accept. Patch at
`memory/coordination/runs/en-display-translation-improvement-claude.patch`
touches only the four allowed files; apply and run combined verification.
