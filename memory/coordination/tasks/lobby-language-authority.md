# Task: lobby-language-authority

## Status

Accepted (2026-07-16)

Integrated at cycle 5. In-game pill removed, game language captured at
startGame and threaded through all three day-speech layers + wolf night
chat (EN native, zh byte-identical). 231/231 tests pass, build OK.
Review: `lobby-language-authority-review.md` — VERDICT PASS all 9 criteria.

## Objective

Make the lobby the single language authority: remove the in-game header language
pill (lobby pill stays), capture the lobby-selected language at `startGame` as the
fixed game language, and thread it through the AI speech pipeline so that in an
EN game all three speech layers (LLM, speech library, hardcoded fallback) and wolf
night chat produce full English speeches natively — no reliance on async
display-layer translation — while zh games remain behaviorally identical.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/en-display-translation-improvement.md` (why the display-layer EN rescue exists — it stays as safety net)

## Context

- **Owner requirement**: the current language toggle only translates in-game
  system logs; AI speeches stay Chinese in EN mode (rescued by async display
  translation at best). The lobby pill must become the only toggle; the game's
  language is decided when the game starts; AI speeches must be generated in
  that language.
- **Toggle pill rendered twice** in `src/App.tsx`: lobby header (~lines 144–150)
  and in-game header (~lines 220–226). Remove ONLY the in-game one. During a
  game the user then cannot change `displayLanguage`, so display language ==
  game language by construction.
- **Game language capture**: `useGameState` (`src/hooks/useGameState.ts:88`) does
  not currently know the display language; `startGame(nextConfig)` is at line
  261 and is called from `App.tsx:184`. Suggested minimal approach: pass
  `displayLanguage` into the hook (via its arg object) or into `startGame`, and
  snapshot it into game state (e.g. `gameLanguage: DisplayLanguage`) at start.
  Import the existing `DisplayLanguage` type from `src/i18n/index.ts` — do not
  invent a new language type.
- **Day speech pipeline** (`src/ai/aiOrchestrator.ts` `generateAIDialogue`,
  lines 86–158) is zh-only by construction:
  - LLM layer: prompts hardcode Chinese output (lines 119–132, JSON
    `{"en":"short English summary","zh":"Chinese speech"}`); acceptance requires
    `isChinese(llmResult.zh)` (line 136).
  - Library layer: `pickSpeech(player.role, [], round)` (line 143) omits the
    existing `PickSpeechOptions.language` option, then requires
    `isChinese(libText)` (line 144) — the corpus has ZERO zh entries so this
    layer never fires today.
  - Fallback layer: `buildFallback` (lines 299–333) returns full-Chinese `zh`
    plus canned EN stubs (`Speaks based on game situation.` /
    `Pushes suspicion on Player N.` / `Frames Player N.` / `Seer reports: …`).
- **Required EN behavior per layer** (add a `language: DisplayLanguage` param,
  default `'zh'`, to `generateAIDialogue` and `generateWolfChat` — additive,
  non-breaking):
  - LLM layer: in EN mode, prompt for a FULL English speech in the `en` field
    (60–160 English words, must mention player numbers), `zh` may be a short
    Chinese summary or empty; accept on a substantive-English check of `en`
    (mirror the spirit of the existing `isChinese` acceptance — do not accept
    empty/stub text).
  - Library layer: in EN mode, call `pickSpeech` with `{ language: 'en' }` —
    reuse the existing `matchesDisplayLanguage` machinery in
    `src/services/speechLibrary.ts`; EN entries exist for every pool
    (villager 890, werewolf 822, seer 173, possessed 159, bodyguard 121,
    medium 118; Witch→seer pool, Hunter/Idiot→villager pool). Validate the pick
    is English (not `isChinese`), and make the suspect mention English
    (e.g. `(watching Player N)`).
  - Fallback layer: `buildFallback` takes the language and returns real,
    full-English lines mirroring the Chinese templates (seer report, wolf
    framing lines, villager suspicion lines) — NOT the existing canned stubs.
- **GameLog bilingual contract stays sensible**: in EN games log the speech as
  `message` = full English text, `translation` = zh text when available
  (`addLog(en, false, speakerId, zh, 'speech')` at `useGameState.ts:549` —
  in zh mode this call stays byte-identical). Genuine English text will not
  match the stub detector in `pickTranslationSource`, so the existing
  display-layer safety net (`src/i18n/index.ts:72–85`, lazy AI translation in
  `LogMessage.tsx`) is untouched and never fires for EN-native speeches.
- **Wolf chat** (`generateWolfChat`, aiOrchestrator.ts lines 222–295, rendered
  raw in `src/components/WolfChannel.tsx:14`): in EN mode use an English prompt
  (same JSON shape, `message` in English), prefer EN library picks in the
  fallback (`pickWolfNightSpeech` may gain an optional language param —
  additive), and provide English hardcoded fallback lines mirroring the three
  Chinese ones. Call site: `useGameState.ts:377`.
- **zh mode is the regression trap**: with `language` defaulting to `'zh'`,
  every prompt string, acceptance check, library call, fallback line, and log
  call must be behaviorally identical to today. The 216-test suite guards this.
- **Scope boundary**: language shapes expression only — rule logic in
  `gameEngine.ts` / `beliefTracker` / `actionSelector` is untouched. No
  server-side (Netlify function) changes needed or allowed.
  `src/services/aiPlayer.ts` is legacy — do not touch.
- **Dependencies**: none.
- **Parallel wave**: wave 1, solo card (App.tsx / useGameState.ts /
  aiOrchestrator.ts overlap makes splitting pointless).

## Allowed changes

- `src/App.tsx` (remove in-game pill; pass language into the game hook/start)
- `src/hooks/useGameState.ts` (capture game language at start; thread it into
  `generateAIDialogue` / `generateWolfChat` calls)
- `src/ai/aiOrchestrator.ts` (language param, EN prompts, EN acceptance checks,
  EN library option, EN fallback lines, EN wolf chat)
- `src/services/speechLibrary.ts` (ONLY additive optional language plumbing,
  e.g. `pickWolfNightSpeech` language option — reuse `matchesDisplayLanguage`;
  no behavior change for existing callers/defaults)
- `src/i18n/index.ts` (ONLY if a type/helper export is genuinely needed;
  `pickLogText` / `pickTranslationSource` semantics must not change)
- Test files (e.g. `src/ai/aiOrchestrator.test.ts` new or existing,
  `src/services/speechLibrary.test.ts`, `src/i18n/i18n.test.ts`)

## Do not change

- `src/components/LogMessage.tsx`, `src/services/translationService.ts` (the
  display-layer translation safety net stays exactly as is).
- `src/gameEngine.ts`, `src/ai/beliefTracker.ts`, `src/ai/actionSelector.ts`,
  `src/services/aiPlayer.ts` (legacy), `src/data/*_speeches.json`,
  `netlify/functions/*`.
- The bilingual system-log convention (`addLog(en, true, undefined, zh, tone)`)
  and any of its ~25 call sites.
- Public API signatures in a breaking way (additive optional params only).
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. The in-game header language pill is removed; the lobby pill remains the only
   language toggle and keeps its current behavior (localStorage key
   `werewolf_display_language` unchanged).
2. The game language is captured once at `startGame` from the lobby selection
   and is the language used for all AI generation in that game.
3. In an EN game, day speeches are full English from ALL three layers without
   relying on async display translation:
   - LLM layer prompts for and accepts full English speech in `en`;
   - library layer picks EN corpus entries (`pickSpeech` with
     `{ language: 'en' }`) and validates English;
   - fallback layer produces real full-English lines (mirroring the Chinese
     templates), never the canned stubs.
4. In an EN game, wolf night chat messages are English (English prompt, EN
   library preference, English hardcoded fallback lines).
5. EN-game speech logs are stored as `message` = English text (plus zh
   `translation` when available), so `LogMessage` renders them directly with no
   translation request; system messages remain bilingual and unchanged.
6. zh games are behaviorally identical to today: prompts, acceptance checks,
   library calls, fallback lines, wolf chat, and log calls unchanged
   (`language` defaults to `'zh'` everywhere).
7. New unit tests cover the language threading: EN vs zh `buildFallback`
   output, EN library-layer path (crafted/mocked pool, English validation),
   EN wolf-chat fallback lines, zh-default equivalence, and game-language
   capture at start. Mock `generateSpeechWithLLM` — no network in tests.
8. Baseline 216 tests still pass, plus the new tests; zero regressions.
9. `npm run build` succeeds.

## Verification

```bash
npm run test:run   # baseline 216 pass + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/lobby-language-authority.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
- Deployment is out of scope for the worker — the coordinator deploys after
  owner approval.
