# Review: lobby-language-authority

**Reviewer:** $aiwerewolf-debugger
**Date:** 2026-07-16
**Worktree:** /Users/frank/aiwerewolf-worktrees/lobby-language-authority

## Verification Reproduction

```
npm run test:run  →  21 files, 231/231 passed (baseline 216 + 15 new, zero failures)
npm run build     →  TypeScript + Vite production build succeeded (941ms)
```

## Findings per Acceptance Criterion

### Criterion 1: In-game header pill removed; lobby pill intact; localStorage key unchanged
**VERDICT: PASS**

- `src/App.tsx:219-226` (old): the in-game `<button onClick={toggleDisplayLanguage}>` pill element is removed. A comment remains in its place at line 219: `{/* Language is fixed at startGame from the lobby pill — no in-game toggle. */}`.
- `src/App.tsx:184`: `game.startGame(mode, displayLanguage)` — lobby pill value `displayLanguage` is threaded into game start; the lobby pill itself (lines ~144-150) is unchanged.
- localStorage key `werewolf_display_language` is not referenced in the diff — unchanged.

### Criterion 2: Game language snapshotted at startGame and used for all AI generation
**VERDICT: PASS**

- `src/hooks/useGameState.ts:271`: `startGame(nextConfig, language?)` snapshots via `setGameLanguage(resolveGameLanguage(language))`.
- `src/hooks/useGameState.ts:99`: `gameLanguage` state initialized to `DEFAULT_DISPLAY_LANGUAGE` ('zh').
- `resolveGameLanguage` exported as pure function, defaults missing/undefined to `'zh'`.
- `gameLanguage` threaded into `generateWolfChat` at line 388 (inside `handleWerewolfPhase`) and `generateAIDialogue` at line 558 (inside `handleDiscussion`).

### Criterion 3: EN day speech native from ALL 3 layers
**VERDICT: PASS**

- **LLM layer** (`aiOrchestrator.ts:128-142`): EN system prompt uses English role strategies (lines 131-138), EN user prompt requires "full daytime speech in ENGLISH (60-160 English words, must mention specific player numbers as 'Player N')". Acceptance at line 177: `isSubstantiveEnglish(llmResult.en)` — rejects text <12 words and text with CJK/kana.
- **Library layer** (`aiOrchestrator.ts:144-153`): calls `pickSpeech(player.role, [], round, { language })` with `{ language: 'en' }`, validates `isEnglish(libText)` (rejects CJK/kana), appends `(watching Player N)` mention using `globalBeliefTracker.getMostSuspicious`.
- **Fallback layer** (`aiOrchestrator.ts:378-432`): `buildFallback` in EN mode returns real full-English lines for Seer ("I am the seer. Last night I checked Player N..."), Werewolf (3 framing lines mirroring the zh templates), and Villager (3 suspicion lines mirroring the zh templates). Never returns the canned stubs (`"Frames Player N."`, etc.) in EN mode.
- All three layers confirmed working end-to-end in the test at `aiOrchestrator.test.ts:77-193` (LLM/en acceptance, LLM/stub rejection, library/EN pick + mention, library/zh pick rejection, fallback/EN full lines for all roles).

### Criterion 4: Wolf night chat English in EN mode
**VERDICT: PASS**

- System prompt: `"You are the werewolf night team. Discuss strategy concisely in English."` (line 291).
- User prompt in English with `"Player N"` references (lines 293-298).
- `pickWolfNightSpeech('en')` called (line 339), filters to English corpus entries.
- `libOk` expression (line 343): rejects non-English library picks in EN mode; zh mode preserves the exact old `length > 15` condition.
- Hardcoded English fallback lines (lines 349-351): `"I suggest we hit Player N tonight."`, `"Tomorrow one of us needs to fake-claim seer — I can take that jump."`, `"Do not charge during the day; hook back and cover the fake seer."`.
- Tests confirm EN prompt threading, EN library preference/rejection, and zh exact-line equivalence (`aiOrchestrator.test.ts:195-251`).

### Criterion 5: EN speech logging and system log isolation
**VERDICT: PASS**

- `addLog(response.en, false, id, response.zh, 'speech')` at `useGameState.ts:559` is byte-identical to the original — no change.
- In EN mode: `response.en` is the full English speech, `response.zh` carries the Chinese text (from LLM summary or zh fallback template). `LogMessage` renders `en` directly via `pickTranslationSource`/`pickLogText` (the EN text is not a canned stub, so the stub-detector rescue never fires).
- No `addLog` system-call sites modified anywhere in the diff.
- `LogMessage.tsx` and `translationService.ts` confirmed unmodified (boundary check: empty diff).

### Criterion 6: zh regression safety
**VERDICT: PASS**

- All `language` parameters default to `'zh'` (`generateAIDialogue`, `generateWolfChat`, `buildFallback`, `pickWolfNightSpeech`).
- zh prompts byte-identical: `"你是一名狼人杀高手"`, `"当前局面：第${round}轮"`, `"请输出一段白天发言（80-180中文字符，必须提到具体玩家编号）"`, `"你们是狼人夜间团队，用中文简洁商量策略。"`.
- zh LLM acceptance: `isChinese(llmResult.zh)` unchanged at line 181.
- zh library call: `{ language: 'zh' }` — same behavior as before (the `PickSpeechOptions.language` option already existed, defaults to matching display language; `'zh'` is explicit).
- zh wolf chat `libOk`: evaluates to `libText && libText.length > 15 && (true)` = `libText && libText.length > 15` — exactly the pre-existing condition.
- zh fallback lines: all Chinese strings in `buildFallback` identical to original (seer report, 3 wolf framing lines, 3 villager suspicion lines).
- zh canned EN stubs in `buildFallback` output unchanged: `"Frames Player N."`, `"Pushes suspicion on Player N."`, `"Seer reports: Player N is GOOD/WOLF."`.
- Test confirms zh-default equivalence at `aiOrchestrator.test.ts:102-113` (LLM prompt), `:142-153` (library layer), `:157-170` (fallback layer), `:238-249` (wolf chat exact-line match).

### Criterion 7: New unit tests coverage
**VERDICT: PASS**

- `src/ai/aiOrchestrator.test.ts` (new, 14 tests): `resolveGameLanguage` capture (2), LLM layer EN acceptance/stub-rejection/zh-equivalence (3), library layer EN pick+mention/zh-rejection/zh-equivalence (3), fallback layer zh-canned-stubs/EN-full-lines (2), wolf chat EN prompt+fallback/EN-rejection/EN-library-keep/zh-exact-lines (4).
- `src/services/speechLibrary.test.ts` (additive, 1 test): EN preference combined with `filterSelfReveal: false` for wolf night chat.
- `generateSpeechWithLLM` is mocked via `vi.mock('./geminiAdapter')` — no network calls.
- `pickSpeech` and `pickWolfNightSpeech` are mocked — no dynamic imports of JSON speech data.

### Criterion 8: Baseline + new tests pass
**VERDICT: PASS**

- 21 test files, 231 tests passed (216 baseline + 15 new), zero failures, zero regressions.
- Reproduced personally in the worktree.

### Criterion 9: Build succeeds
**VERDICT: PASS**

- `tsc` + `vite build` both succeeded, 1575 modules transformed, all chunks emitted.

## Boundary Check

- **Forbidden files unmodified**: `LogMessage.tsx`, `translationService.ts`, `gameEngine.ts`, `beliefTracker.ts`, `actionSelector.ts`, `aiPlayer.ts`, `data/*.json`, `netlify/functions/*` — all confirmed via `git diff --stat` returning empty output for those paths.
- **No git operations**: no commits, branches, or merges in the worktree.
- **No existing tests weakened**: `speechLibrary.test.ts` received one additive test only (lines 153-161); no existing test expectations were altered. All 216 baseline tests pass unmodified.

## Quality Review

- **Type safety**: `DisplayLanguage` imported from `src/i18n/index.ts` — no new language type invented. No `any` casts introduced in the diff.
- **EN edge case: LLM returns Chinese**: `isSubstantiveEnglish` rejects it (CJK/kana present → `isEnglish` fails) → falls to library layer.
- **EN edge case: library returns Japanese entry**: `isEnglish` check fails (kana present) → falls to hardcoded EN fallback.
- **EN edge case: library returns EN text under 12 words**: `isSubstantiveEnglish` is only for LLM; the library path uses `isEnglish` + `length > 20`. The 20-char threshold adequately rejects short stubs.
- **JA-dominant corpus**: `pickSpeech` with `{ language: 'en' }` uses the existing `matchesDisplayLanguage('en')` machinery inside `pickSpeechFromEntries`, which already filters to entries matching the display language. This includes the existing `>= 3` threshold behavior.
- **Role-pool mapping**: `pickSpeech` (and `pickWolfNightSpeech` which delegates to `pickSpeech`) role pools unchanged — Witch→seer pool, Hunter/Idiot→villager pool mapping lives inside `speechLibrary.ts` and was not altered.
- **Dead player**: the `isAlive` filter in `buildFallback` is unchanged. Speech generation only runs for alive players (gated by the `isAlive` check in `useGameState` before calling `generateAIDialogue`).
- **`isCannedEnglishStub`**: imported in the new test from `src/i18n/index.ts` (pre-existing export, line 63). Not a new addition.

## Summary

All 9 acceptance criteria pass. 231/231 tests, build succeeds. No forbidden files touched. zh path is byte-identical. No regressions.

VERDICT: PASS
