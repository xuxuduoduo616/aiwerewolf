# Report: lobby-language-authority

## Status

Ready for review

## Summary

The lobby is now the single language authority. The in-game header language
pill is removed (lobby pill unchanged, `werewolf_display_language` key
untouched). `startGame(mode, displayLanguage)` snapshots the lobby selection
once into `gameLanguage` state, which threads into `generateAIDialogue` and
`generateWolfChat`. In EN games all three day-speech layers (LLM prompt +
substantive-English acceptance, `pickSpeech({ language: 'en' })` + English
validation + `(watching Player N)` mention, full-English `buildFallback`
lines) and wolf night chat (English prompt, `pickWolfNightSpeech('en')`,
English hardcoded lines) produce native English. zh games are behaviorally
identical: every prompt string, acceptance check, library call, fallback
line, and log call is unchanged with `language` defaulting to `'zh'`.

## Changed files

- `src/App.tsx` — removed the in-game header pill (comment left in place);
  `game.startGame(mode)` → `game.startGame(mode, displayLanguage)`.
- `src/hooks/useGameState.ts` — new pure export `resolveGameLanguage`
  (missing value → `DEFAULT_DISPLAY_LANGUAGE`, i.e. zh); `gameLanguage`
  state snapshotted in `startGame(nextConfig, language?)`; threaded as the
  new trailing argument into `generateWolfChat` (`handleWerewolfPhase`) and
  `generateAIDialogue` (`handleDiscussion`). The
  `addLog(response.en, false, id, response.zh, 'speech')` call is
  byte-identical — in EN games `response.en` is now full English and
  `response.zh` the zh text when available.
- `src/ai/aiOrchestrator.ts` — additive trailing `language: DisplayLanguage
  = 'zh'` on `generateAIDialogue`, `generateWolfChat`, and `buildFallback`;
  new local helpers `isEnglish` / `isSubstantiveEnglish` (mirrors the local
  `isChinese` convention; ≥12 English words, no CJK/kana — all canned stubs
  are well under that). EN branches: English system/user prompts (JSON
  `{"en":"full English speech","zh":"short Chinese summary"}`), acceptance on
  `isSubstantiveEnglish(llmResult.en)`, library call with `{ language }`,
  English validation + English mention, full-English fallback/wolf-chat
  lines (zh fields keep the full Chinese templates as translation source).
  Belief updates use the accepted-language text (`Player N` refs are already
  parsed by `beliefTracker.updateFromSpeech`).
- `src/services/speechLibrary.ts` — `pickWolfNightSpeech(language:
  DisplayLanguage = 'zh')`, forwarded into the existing
  `matchesDisplayLanguage` machinery via `PickSpeechOptions.language`.
  Default identical to before.
- `src/ai/aiOrchestrator.test.ts` (new, 14 tests) — mocks `./geminiAdapter`
  and `../services/speechLibrary` (no network): EN LLM acceptance + prompt
  threading, EN stub rejection, EN library path (`{ language: 'en' }` call,
  English validation, English mention, Chinese-pick rejection), EN vs zh
  `buildFallback` for Villager/Werewolf/Seer (zh asserted against the exact
  canned stubs and cross-checked with `isCannedEnglishStub`), EN wolf-chat
  prompt/library/fallback lines, zh-default wolf-chat exact-line equivalence,
  and `resolveGameLanguage` capture defaults.
- `src/services/speechLibrary.test.ts` — 1 new test: EN preference combined
  with `filterSelfReveal: false` (the exact option pair
  `pickWolfNightSpeech('en')` uses).

## Verification

- `npm run test:run` — 21 files, **231/231 passed** (baseline 216 + 15 new,
  zero regressions, no existing test modified beyond the speechLibrary
  addition).
- `npm run build` — TypeScript + Vite production build succeeded.

## Decisions

- Language is passed to `startGame` rather than the hook's arg object — the
  smallest change that snapshots exactly once at game start; `AuthContext`
  stays untouched. `resolveGameLanguage` is exported pure (same convention as
  `runAIPhaseSafely` / `shouldAutoResolveVote`) because the repo has no
  jsdom/renderHook setup for hook-state tests.
- `geminiAdapter.generateSpeechWithLLM` (not in allowed paths) drops
  responses with an empty `zh` field, so the EN prompt requires a short
  Chinese summary in `zh`. If a model still omits it, the call returns null
  and the EN library/fallback layers take over — output stays English.
- EN library picks return `{ en, zh: '' }` (no zh original exists for a
  corpus pick); `addLog` stores the empty translation, which is falsy for
  `pickLogText`/`pickTranslationSource`, so the display layer renders the
  English directly. `src/i18n/index.ts`, `LogMessage.tsx`, and
  `translationService.ts` are untouched — the EN stub-rescue safety net stays
  as is and never fires for EN-native speeches.
- Wolf chat in EN validates the mixed-corpus pick with `isEnglish` before
  use (criterion 4 requires English messages); zh mode keeps the exact
  original `length > 15` condition. `strategyTag` stays the Chinese enum
  (typed literal union rendered as a badge in `WolfChannel`).

## Residual risks

- LLM EN quality depends on the live model honoring the JSON shape; on any
  miss the deterministic library/fallback layers guarantee English, so the
  worst case is less varied speech, never Chinese leakage.
- `WolfChannel` chrome (狼队夜聊 header, `N号` speaker label, Chinese
  strategy tags) and other UI chrome strings remain Chinese — out of this
  card's scope (card covers speech generation, not UI chrome).
- Wolf night chat browser coverage still depends on random role assignment
  (pre-existing PROJECT_STATE gap); unit tests cover both languages.

## Recommendation

Accept. Suggest the debugger replays: `npm run test:run` + `npm run build`
in the worktree, plus a quick EN-game browser pass (lobby pill → EN → start
9p as guest) confirming full-English AI speeches with no in-game pill.
