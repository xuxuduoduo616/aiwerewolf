# Review: speech-quality-filter (DEBUGGER)

**Reviewer role:** Debugger (independent verification, no product code edited)
**Date:** 2026-07-16
**Worktree:** `.claude/worktrees/agent-afe67687774ce9a27`
**Patch:** `memory/coordination/runs/speech-quality-filter-claude.patch`

## 1. Scope check

`git status --short` in the worktree:

- `M  src/services/speechLibrary.ts` — allowed
- `A  src/services/speechLibrary.test.ts` — allowed (test file; gitignored by `**/*.test.ts`, force-added, consistent with the 17 already-tracked test files)
- `?? memory/coordination/reports/speech-quality-filter.md` — the required worker report
- `?? node_modules` — build artifact, not part of the change

No disallowed files touched. `aiOrchestrator.ts`, corpus JSON files, and `PROJECT_STATE.md` are untouched.

**Patch check:** `git apply --check` against the main repo (`/Users/frank/aiwerewolf`) passes cleanly. The patch contains exactly the two allowed files.

## 2. Reproduction

Run in the worktree:

- `npm run test:run` — **18 files, 179/179 passed** (baseline 163 + 16 new in `speechLibrary.test.ts`). Zero regressions.
- `npm run build` — TypeScript + Vite production build succeeded.

Matches the coder report exactly.

## 3. Leakage filter review (criterion 1, 2)

`WOLF_SELF_REVEAL_PATTERNS` (`speechLibrary.ts:33-40`) covers:

- **Japanese wolf:** `(私|僕|俺|わたし|あたし)[はがも]?人狼` with negative lookahead `(?!では|じゃ|であり|ではあり)` — matches 私は人狼 / 私は人狼です / 僕が人狼; excludes denials 私は人狼ではない / じゃない. (「狼側」 per se is not matched, but no such entries exist in the acceptance patterns; the listed card patterns are all covered.)
- **Chinese wolf:** `我(就|们|們)?是狼(人)?` — matches 我是狼人 / 我是狼 / 我就是狼 / 我们是狼人; 我不是狼人 does not match (不 breaks adjacency). Consistent with `LEAKAGE_RULES` `/我(就|们)?是狼/` in `src/ai/evaluation.ts:81` (superset: adds 們 and optional 人).
- **English wolf:** `\bI\s*(?:am|'m)\s+(?:a\s+|the\s+)?werewolf\b/i` — matches "I am a werewolf", "I'm the werewolf"; "I am not a werewolf" does not match.
- **Possessed/狂人 (all three languages):** analogous patterns (私は狂人 / 我是狂人 / I am the possessed) with the same denial exclusions.

**Speaker-role-specific:** `revealsHiddenRole` (`speechLibrary.ts:46-47`) returns true only when `role === Role.WEREWOLF`. The game's `Role` enum has no possessed role (Werewolf/Villager/Seer/Witch/Hunter/Idiot), so applying 狂人 patterns to werewolf speakers (possessed is wolf-team in the source corpus, its phrases leak wolf alignment) is the correct interpretation. Non-wolf speakers are never filtered — verified by test at `speechLibrary.test.ts:76-79`.

**Seer CO exemption:** no pattern matches 预言家 / 占い師 / "I am the seer"; a wolf fake-claiming seer remains pickable. Verified by tests at lines 64-74 and 94-99.

**Scope of filter:** `filterSelfReveal` defaults to `true` in `pickSpeechFromEntries`/`pickSpeech`; `pickWolfNightSpeech` (`speechLibrary.ts:156-160`) explicitly passes `filterSelfReveal: false` — night wolf chat is exempt as required. Filter is applied before the day/language/tag fallbacks (`speechLibrary.ts:111-114`), so no fallback path can reintroduce a leaking entry. Call sites confirmed: `aiOrchestrator.ts:125` (day speech → filter on), `aiOrchestrator.ts:257` (night chat → filter off via `pickWolfNightSpeech`). `pickMultipleSpeches` (wolf-chat options, night context) unchanged and not imported by `aiOrchestrator` anyway.

## 4. Language preference (criterion 3)

`options.language?: DisplayLanguage` (type-only import from `src/i18n`, `'zh' | 'en'`), default `'zh'`. The `zh` path uses the identical `isChineseText` predicate and the identical `>= 3` thin-pool fallback as HEAD, so default behavior is exactly the previous behavior plus the leakage filter. `en` matches Latin text with zero CJK/kana. Fallback to the mixed pool prevents new empty results; `''` is returned only for an empty pool or a fully-leaking pool (both already handled by callers via `libText && libText.length > 20` / `> 15` guards).

## 5. API compatibility (criterion 4)

All four exports keep their signatures; changes are additive only (`options: PickSpeechOptions = {}` trailing optional parameter on `pickSpeech`; new exports `revealsHiddenRole`, `pickSpeechFromEntries`, `PickSpeechOptions`). `aiOrchestrator.ts` is byte-identical to HEAD and the build (which type-checks it) passes.

## 6. Tests (criteria 5, 6)

16 new tests with crafted pools (no corpus dependency), covering: wolf self-reveal flagged JA/ZH/EN, possessed self-reveal flagged, denials not flagged, seer CO not flagged (unit + pick level, wolf fake-claim), role-specificity, day-pick exclusion via 200-iteration sampling, filter-off night scope, all-leaking pool returns `''`, empty pool returns `''`, zh default preference, en preference, thin-pool (<3) fallback, no-language-match never empty, preferred-tag behavior retained, day-proximity behavior retained. Thorough for the card's criteria.

## Defects

None blocking.

Minor observations (safe direction, documented in the coder report, not defects):

- Over-filtering of hypotheticals/mentions for wolf speakers (e.g. 「如果我是狼人…」, 「私は人狼を疑う」 match the patterns). Conservative and acceptable — the acceptance criterion is "never return a self-reveal", and the pool fallback prevents emptiness in practice.
- Integration note: the test file is gitignored, so the coordinator must apply the patch (or `git add -f`) rather than rely on `git add .` — already flagged in the coder report.

## Per-criterion verdicts

1. Wolf + possessed self-reveals excluded from day picks — PASS
2. Seer CO retained — PASS
3. Language preference with graceful fallback, no new empty results — PASS
4. API signatures stable, aiOrchestrator unmodified and compiling — PASS
5. Unit tests with crafted pools cover both behaviors — PASS
6. 179/179 tests (baseline 163 + 16 new), build passes, zero regressions — PASS

VERDICT: PASS
