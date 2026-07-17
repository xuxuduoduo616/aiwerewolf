# Planning Report: lobby-language-authority

**Date:** 2026-07-16
**Planner:** aiwerewolf-planner (Claude subagent fallback)
**Requirement slug:** lobby-language-authority
**Baseline:** HEAD `1421083`, 216 tests passing

## Requirement summary

The lobby language pill must become the sole language authority: remove the
in-game pill; capture the lobby selection at game start; make AI day speeches
and wolf night chat generate natively in the selected language (full English in
EN games, not summaries or async display translation). System logs are already
bilingual — untouched. Deployment stays with the coordinator.

## Cards created

| Card | Wave | Summary |
|---|---|---|
| `memory/coordination/tasks/lobby-language-authority.md` | 1 (solo) | Remove in-game pill; snapshot lobby language at `startGame`; add `language` param (default `'zh'`) to `generateAIDialogue` / `generateWolfChat`; EN behavior for all three speech layers (English LLM prompt + English acceptance, `pickSpeech({language:'en'})` over existing EN corpus entries, full-English `buildFallback` templates) and English wolf chat; zh byte-identical; new unit tests. |

## Why one card

Requirement 1 (pill removal, `src/App.tsx`) and requirement 2 (language
threading) both touch `App.tsx` (the language must be passed into
`useGameState`/`startGame` from the same component that owns the pill state),
plus `useGameState.ts` and `aiOrchestrator.ts`. Splitting would create
overlapping allowed-paths with no parallelism gain and an artificial
integration seam (a "pill removed but game still zh-only" intermediate state
has no standalone value). One coder session keeps the GameLog bilingual
contract decisions consistent across both halves.

## Wave structure

- Wave 1: `lobby-language-authority` alone. No other cards in this requirement.

## Key design decisions baked into the card

1. **Reuse over create**: `DisplayLanguage` type and `useDisplayLanguage`
   already exist (`src/i18n/index.ts`); `PickSpeechOptions.language` and
   `matchesDisplayLanguage` already exist in `speechLibrary.ts` (currently
   dead in prod). The card mandates reusing them — no new i18n machinery.
2. **Additive signatures only**: `language: DisplayLanguage = 'zh'` params so
   zh mode is behaviorally identical and no caller breaks.
3. **Log contract**: EN games log `message` = full English speech,
   `translation` = zh when available; genuine English text bypasses both the
   stub detector (`pickTranslationSource`) and lazy translation
   (`needsTranslation`), so the existing display safety net stays intact and
   dormant — it remains the rescue path for pre-existing zh logs only.
4. **Corpus feasibility verified**: EN entries exist in every role pool
   (villager 890, werewolf 822, seer 173, possessed 159, bodyguard 121,
   medium 118; Witch→seer, Hunter/Idiot→villager mapping), so the EN library
   layer can actually fire — unlike the zh library layer today (0 zh entries).

## Risks

- **zh regression** (highest): every touched code path must default to today's
  behavior. Mitigated by default params, explicit "zh byte-identical"
  acceptance criterion, and the 216-test suite; card also requires a
  zh-default-equivalence unit test.
- **LLM EN quality/acceptance**: an over-strict English check could push every
  EN speech to the library/fallback layers; an over-lax one could accept
  stubs. Card specifies "substantive English" acceptance mirroring the
  `isChinese` gate's spirit and forbids accepting stubs. Debugger should spot-
  check EN outputs from the fallback and library layers.
- **EN library pool thinness for minor roles** (seer 173, medium 118 mapped
  pools): `matchesDisplayLanguage`'s ≥3-match threshold plus the fallback
  layer's full-English templates cover the thin case — no empty speeches.
- **Wolf chat JSON parse in EN**: same parse path as zh; English prompt keeps
  the identical JSON shape, so parse risk is unchanged.

## Open questions for the coordinator

1. Mid-game lobby changes: after the in-game pill is removed the user cannot
   toggle during a game, so game language == display language by construction.
   If a future feature reintroduces mid-game display switching, the captured
   `gameLanguage` (not live `displayLanguage`) must drive generation — the
   card stores it at start for exactly this reason.
2. EN-game zh `translation` field: the card allows zh summary or absent. If
   the owner later wants full-zh translations of EN speeches for record
   review, that is a separate display/translation card.
3. Browser QA (an actual EN playthrough verifying English speeches and wolf
   chat) is coordinator/QA scope after integration, not in the worker card.
