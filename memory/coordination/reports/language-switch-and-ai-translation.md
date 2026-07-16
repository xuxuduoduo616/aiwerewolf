# Report: language-switch-and-ai-translation

**Status:** Ready for review
**Worker:** Claude coder (isolated worktree `.claude/worktrees/agent-ae5b270c870948bfd`)
**Patch:** `memory/coordination/runs/language-switch-and-ai-translation-claude.patch`

## Summary

Display-layer language switch (zh/en) with localStorage persistence, plus an AI
translation service that detects mismatched-language speeches (kana → ja,
CJK-ratio → zh, ASCII-dominant → en) and translates them through the existing
Netlify proxy — cached per log-entry id, falling back to the original text on
any failure or in local Vite dev. Game state, votes, roles, log ordering, and
`useGameState.ts` are untouched.

## Changed files

- `src/i18n/index.ts` (new) — `DisplayLanguage` type, localStorage
  load/save (`werewolf_display_language`, default `zh`), `nextDisplayLanguage`,
  `pickLogText` (bilingual-field selection: `translation` = zh, `message` = en),
  and the `useDisplayLanguage` React hook.
- `src/services/translationService.ts` (new) — `TRANSLATION_ENDPOINT`
  (single exported constant, currently `/.netlify/functions/genai-proxy`),
  `detectLanguage`, `needsTranslation`, `translateLogText` with cache +
  in-flight dedup, `clearTranslationCache` (test hook).
- `src/components/LogMessage.tsx` (new) — renders a log entry in the display
  language; async-translates mismatched speech entries; small "view original /
  view translation" toggle after a translation is applied.
- `src/App.tsx` — wiring only: `useDisplayLanguage` hook; the two former
  `Languages` icon buttons (lobby header + game header) are now a visible
  language pill toggle showing `中文`/`EN`; the two `game.visibleText(log)`
  render sites now use `<LogMessage log language>`.
- `src/i18n/i18n.test.ts`, `src/services/translationService.test.ts` (new
  tests, force-added like the existing tracked test files since `.gitignore`
  excludes `**/*.test.ts` from Netlify deploys).

## Design decisions

- **Reused bilingual fields.** `GameLog.message` is English and
  `GameLog.translation` is Chinese by repo convention; `pickLogText` selects
  the field for the display language, so system messages and vote-record log
  entries follow the toggle with zero AI calls. No parallel display state.
- **Detection:** any kana (U+3040–U+30FF, U+31F0–U+31FF) → `ja`; else CJK
  ideograph ratio >= 0.3 → `zh`; else printable-ASCII ratio >= 0.7 → `en`;
  else `unknown` (never translated — fail-safe).
- **Translation path:** POST to `TRANSLATION_ENDPOINT` with the proxy's
  existing body shape (`model: gemini-2.5-flash`, plain-text response,
  temperature 0.2). Swapping to `provider-adapter` later is a one-line change.
- **Cache/dedup:** module-level `Map` keyed `${logId}:${language}` plus an
  in-flight promise map, so a log entry is fetched at most once per target
  language, including under concurrent renders. Failures cache the original
  text so a failing proxy is never retried per entry.
- **Fallback:** `isLocalVite` guard (same port set as `geminiAdapter.ts`,
  duplicated because it is not exported there and that file is out of scope);
  non-ok/empty/thrown responses all resolve to the original text.
  `translateLogText` never throws and never blocks rendering — `LogMessage`
  shows the base text immediately and swaps in the translation when it lands.
- **Only speech entries are AI-translated** (`log.isSystem` skips straight to
  bilingual-field selection), per the card.

## Verification

- `npm run test:run` — 10 files, **72/72 passed** (worktree baseline at HEAD
  `b7a8529` was 8 files / 47 tests; +25 new tests, zero regressions).
- `npm run build` — TypeScript + Vite production build succeeded.
- New tests cover: toggle persistence (save/load/invalid/no-storage),
  detection routing (ja/zh/en/unknown), zh↔en mismatch routing, fetch-count
  cache dedup (sequential + concurrent + distinct ids), failure fallback
  (reject / non-ok / empty result), local-Vite no-fetch guard, and
  bilingual-field display selection.

## Limitations / residual risks

- `useGameState.ts` still exports the now-unused `translateEnabled` /
  `visibleText`; the hook is off-limits for this card, so the dead state was
  left in place (candidate for a follow-up cleanup card).
- `VoteSummary.tsx` decorative labels ("放逐投票结果" etc.) are hardcoded
  Chinese and carry no bilingual fields; the card scopes vote summaries to
  entries that already carry bilingual fields (the vote-record log entry does
  follow the toggle). Localizing the component chrome would be new i18n string
  work — out of scope.
- Real proxy translation quality/latency is unverifiable locally (local Vite
  intentionally no-ops); needs a deployed-environment spot check.
- Short/ambiguous speeches may detect as `unknown` and render untranslated by
  design.

## Recommendation

Accept. The diff is display-layer only, additive, and passes combined
verification. Suggest a follow-up card to remove the dead
`translateEnabled`/`visibleText` from `useGameState.ts` once this is merged.
