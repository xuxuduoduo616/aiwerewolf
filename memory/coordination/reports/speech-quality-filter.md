# Report: speech-quality-filter

## Status

Ready for review

## Summary

`src/services/speechLibrary.ts` now (a) excludes day/discussion picks whose text
self-reveals the speaker's hidden role and (b) prefers entries matching the
requested display language (`zh` default, `en` supported) with the existing
`>= 3` thin-pool fallback. All existing exported signatures are unchanged
(additive optional `options` parameter only); `aiOrchestrator` needed no edits.

## Changed files

- `src/services/speechLibrary.ts`
- `src/services/speechLibrary.test.ts` (new, 16 tests)

Patch: `memory/coordination/runs/speech-quality-filter-claude.patch`
(only these two files; note `**/*.test.ts` is gitignored, so integration must
apply the patch or `git add -f` the test file, matching the 23 already-tracked
test files).

## Implementation decisions

1. **Leakage filter** — new exported `revealsHiddenRole(text, role)` keyed to
   the SPEAKER role: only `Role.WEREWOLF` speakers are filtered, against JA/ZH/EN
   wolf self-reveals (`私は人狼` incl. 僕/俺 variants, `我(就|们)?是狼(人)?`
   consistent with `LEAKAGE_RULES` in `src/ai/evaluation.ts`,
   `I am (a|the )?werewolf` incl. `I'm`) plus possessed/狂人 self-reveals
   (possessed is wolf-team in the aiwolf corpus, so it leaks wolf-side
   alignment). Japanese negative lookaheads and the pattern shapes keep denials
   (「私は人狼ではない」/ 我不是狼人 / "I am not a werewolf") pickable. Seer CO
   is never matched — a wolf fake-claiming 预言家 stays pickable by design.
2. **Scope** — the filter is on by default (day/discussion) and disabled via
   `filterSelfReveal: false` only inside `pickWolfNightSpeech` (wolf-team-internal
   night chat). It applies before the day/tag/language fallbacks so no fallback
   path can reintroduce a leaking entry; a degenerate all-leaking pool returns
   `''`, which every caller in `aiOrchestrator` already handles (`libText &&
   libText.length > 20` guards).
3. **Language preference** — `pickSpeech`/`pickSpeechFromEntries` accept
   `options.language?: DisplayLanguage` (type-only import from `src/i18n`, so no
   runtime React dependency). `zh` keeps the exact previous `isChineseText`
   behavior; `en` matches Latin text with zero CJK/kana. The `>= 3` fallback to
   the mixed pool is preserved, so no new empty results.
4. **Testability** — the selection pipeline was extracted into pure
   `pickSpeechFromEntries(entries, role, preferTags, round, options)`; tests use
   crafted pools and never touch the 11k-entry corpus.

## Verification

- `npm run test:run` — 18 files, **179/179 passed** (baseline 163 + 16 new,
  zero regressions).
- `npm run build` — TypeScript + Vite production build succeeded.

## Residual risks

- Pattern-based filtering is intentionally conservative: hypothetical phrasings
  such as 「如果我是狼人…」 are also excluded for wolf speakers (safe direction —
  matches the `evaluation.ts` rule shape); exotic paraphrased self-reveals not in
  the pattern list would still pass. Corpus-level audit was out of scope.
- `pickMultipleSpeches` (wolf chat options, night context) is unchanged per the
  card's day/discussion scoping.

## Recommendation

Accept. Apply the patch (force-add needed for the gitignored test file), rerun
`npm run test:run` and `npm run build` after integration.
