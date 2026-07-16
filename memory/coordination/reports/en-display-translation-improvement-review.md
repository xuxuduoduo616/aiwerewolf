# Debugger Review: en-display-translation-improvement

**Reviewer:** Debugger role (independent verification)
**Date:** 2026-07-16
**Worktree:** `.claude/worktrees/agent-ab7a60c34a6db85a2`
**Patch:** `memory/coordination/runs/en-display-translation-improvement-claude.patch`

## Scope check

Files changed vs HEAD in the worktree:

- `src/components/LogMessage.tsx` — allowed
- `src/i18n/index.ts` — allowed
- `src/i18n/i18n.test.ts` — allowed (test file)
- `src/services/translationService.test.ts` — allowed (test file)
- `memory/coordination/tasks/en-display-translation-improvement.md` — status set to
  `Ready for review` (required by the handoff protocol; not in the patch)
- `memory/coordination/reports/en-display-translation-improvement.md` — worker report
  (untracked; required handoff artifact)

`src/services/translationService.ts` is untouched (helper lives in `src/i18n/index.ts`,
permitted by the card). `src/ai/aiOrchestrator.ts` and `src/hooks/useGameState.ts` are
UNTOUCHED — confirmed via `git diff --name-only HEAD`. No out-of-scope edits.
The patch itself contains only the four allowed source/test files. **Scope: PASS.**

## Patch check

`git apply --check` against main: **clean** (no output, exit 0).

## Reproduction

In the worktree:

- `npm run test:run` — **176/176 passed**, 17 files (baseline 163 + 13 new; expected count matched).
- `npm run build` — TypeScript + Vite production build **succeeded**.

## Per-criterion compliance

1. **Stub → zh original translation source (EN mode):** PARTIAL — see Defect 1.
   For the covered stubs the flow is correct: `pickTranslationSource` returns
   `log.translation` when `language === 'en'`, `!isSystem`, zh original exists,
   and `message` is missing or a matched stub. `LogMessage` renders that zh text
   immediately (pending state), `needsTranslation(zh, 'en')` is true, and
   `translateLogText` runs with the existing semantics. On failure or local Vite
   dev, `translateLogText` returns the source (zh original) and
   `result !== baseText` prevents a stale toggle — the zh original is shown, never
   the stub. Verified by reading `LogMessage.tsx:26-41` and
   `translationService.ts:106-132`, plus the new tests.
2. **"View original" toggle:** PASS. The unchanged toggle path applies: after a
   successful translation, `showOriginal` flips between the translated English and
   `baseText` (now the zh original), with the existing labels ("Show original" /
   "Show translation"). No new toggle code — behavior and labels identical to the
   existing ja→zh path.
3. **No false positives / zh mode unchanged:** PASS. Detection uses anchored
   exact-match regexes (`^...$` after `trim()`), so genuine English speech —
   including supersets like "Pushes suspicion on Player 3 because he lied." —
   never matches (covered by negative tests). In zh mode `pickTranslationSource`
   falls through to `pickLogText` (test asserts equivalence).
4. **System/bilingual entries unaffected:** PASS. `!log.isSystem` guard in
   `pickTranslationSource`, plus the pre-existing `log.isSystem` early return in
   the `LogMessage` effect. Covered by a test.
5. **Same cache/dedup through `translateLogText`:** PASS. `translationService.ts`
   is byte-identical to main; per-log-id cache, in-flight dedup, failure caching,
   and the local-Vite guard are exercised by the new stub-path tests (single fetch
   across concurrent + repeat calls).
6. **Unit tests:** PASS in structure — 8 new i18n tests (stub detection positives
   incl. `Player ?`, negatives, zh-substitution, missing-message, system guard,
   zh-mode equivalence) and 5 new translationService tests (success replaces stub,
   failure → zh original, local dev → zh original without fetch, genuine English
   never fetches, cache dedup). However one negative test encodes Defect 1.
7. **Zero regressions:** PASS. 163 baseline tests still pass; build clean.

## Defects

### Defect 1 — Seer fallback stub not detected (acceptance gap)

`buildFallback` in `src/ai/aiOrchestrator.ts` produces FOUR canned `en` literals,
all of the same class (generic English summary while `zh` carries the real speech):

- `:133` — `'Speaks based on game situation.'` — covered
- `:295` — `` `Seer reports: Player ${seerInfo.targetId} is ${GOOD|WOLF}.` `` — **NOT covered**
- `:306` — `` `Frames Player ${suspect?.id || '?'}.` `` — covered
- `:314` — `` `Pushes suspicion on Player ${suspect?.id || '?'}.` `` — covered

`CANNED_EN_STUBS` in `src/i18n/index.ts` omits the Seer line, and
`src/i18n/i18n.test.ts:90` actively asserts
`isCannedEnglishStub('Seer reports: Player 4 is GOOD.')` is `false`. Consequence:
in EN mode, a fallback Seer speech still displays the terse canned line instead of
a translation of the zh original (`我是预言家，昨晚验了N号，结果是…今天先围绕这个
结果盘逻辑。`), which loses content — exactly the defect class this card fixes.

The coder's report calls this exclusion intentional ("carries real information"),
but the card requires matching "the exact known stubs" and the coder already
extended beyond the two cited line numbers by including the equally uncited Frames
line — excluding only the Seer line is inconsistent, and the verification
directive for this review explicitly names the Seer report line as part of the
known stub set. The string is a `buildFallback` literal, not genuine speech, so
adding it cannot create false positives.

**Repair (bounded):**
1. Add `/^Seer reports: Player \d+ is (GOOD|WOLF)\.$/` to `CANNED_EN_STUBS` in
   `src/i18n/index.ts`.
2. Move `'Seer reports: Player 4 is GOOD.'` from the negative test to the
   positive block in `src/i18n/i18n.test.ts` (both GOOD and WOLF variants), and
   keep a negative superset case (e.g. `'Seer reports: Player 4 is GOOD, trust me.'`).
3. Optionally add one `pickTranslationSource` case for a Seer-stub log.

No other defects found. Everything else (flow, toggle, cache, scope, build,
regressions) verified independently and sound.

Round 1 verdict: FAIL (superseded — see Round 2 below).

## Round 2 (re-verification after fix)

The coder applied the requested repair in the same worktree and regenerated the
patch. Independently re-verified:

1. **Reproduction:** `npm run test:run` — **177/177 passed** (176 + 1 new Seer
   routing test), 17 files. `npm run build` — TypeScript + Vite production
   build **succeeded**.
2. **Defect 1 fixed:** `CANNED_EN_STUBS` in `src/i18n/index.ts` now includes
   `/^Seer reports: Player \d+ is (GOOD|WOLF)\.$/`, an exact anchored match for
   the `buildFallback` literal at `src/ai/aiOrchestrator.ts:295` (`targetId` is
   always numeric, so `\d+` is sufficient — no `?` variant exists for this
   line). Positive detection tests cover both GOOD and WOLF variants
   (`src/i18n/i18n.test.ts`), and a new `pickTranslationSource` test confirms a
   Seer-stub log routes to the zh original in EN mode.
3. **No false positives:** the near-miss negative
   `'Seer reports: Player 4 is probably GOOD, trust me.'` asserts `false`
   (anchored `^...$` rejects any superset), alongside the existing genuine-
   English negatives. zh-mode equivalence and system-message guards unchanged
   and still tested.
4. **Patch:** `git apply --check` against main — clean. `git apply --stat`
   confirms the regenerated patch contains ONLY the four allowed files
   (`src/components/LogMessage.tsx`, `src/i18n/index.ts`,
   `src/i18n/i18n.test.ts`, `src/services/translationService.test.ts`;
   165 insertions, 2 deletions). `src/ai/aiOrchestrator.ts` and
   `src/hooks/useGameState.ts` remain untouched; `translationService.ts`
   unmodified.

All acceptance criteria now fully satisfied; no remaining defects.

VERDICT: PASS
