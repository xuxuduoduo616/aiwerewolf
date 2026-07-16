# Review: language-switch-and-ai-translation

**Debugger:** independent verification in coder worktree
`.claude/worktrees/agent-ae5b270c870948bfd` (HEAD `b7a8529`)
**Date:** 2026-07-16

## Scope check

Staged files (`git status --short` / `git diff --cached --stat`):

| File | Allowed? |
| --- | --- |
| `src/App.tsx` (+19/−4) | Yes — toggle + log display wiring only |
| `src/components/LogMessage.tsx` (new) | Yes — small display component |
| `src/i18n/index.ts` (new) | Yes — `src/i18n/**` |
| `src/i18n/i18n.test.ts` (new) | Yes — test file |
| `src/services/translationService.ts` (new) | Yes |
| `src/services/translationService.test.ts` (new) | Yes — test file |

- No files outside allowed scope. `git diff --cached --name-only` against
  `src/hooks/useGameState.ts`, `src/gameEngine.ts`, `src/ai/`, `netlify/`,
  `package.json`, `package-lock.json` is empty — all off-limits areas untouched.
- No new npm dependencies (package.json unchanged).
- The App.tsx diff is wiring only: replaces the two old `Languages` icon buttons
  with the new pill toggle and swaps the two `game.visibleText(log)` render
  sites for `<LogMessage>`. No game-flow logic changed.
- Patch file `memory/coordination/runs/language-switch-and-ai-translation-claude.patch`
  covers exactly the same 6 files as the worktree staged diff (verified).

## Reproduction (run by debugger in the worktree)

- `npm run test:run`: **10 files, 72/72 passed** (includes new
  `translationService.test.ts` 17 tests, `i18n.test.ts` 8 tests).
- `npm run build`: **succeeded** (TypeScript + Vite, `✓ built in 965ms`).
- Regressions: none. All 8 pre-existing test files pass and none were modified.
  Note: the card's "baseline 55/55" figure is stale — the worktree HEAD
  `b7a8529` baseline is 8 files / 47 tests (47 + 25 new = 72). Documentation
  inconsistency only, not a defect in this patch.

## Acceptance criteria

1. **Toggle visible + localStorage persistence — MET.** Visible pill button
   (`中文`/`EN` with Languages icon) in both lobby and game headers
   (`src/App.tsx:144-151, 220-227`). `useDisplayLanguage` initializes from
   `loadDisplayLanguage()` and `saveDisplayLanguage` writes
   `werewolf_display_language` on every toggle (`src/i18n/index.ts:22-62`),
   so the choice survives reload. Try/catch guards missing localStorage.
2. **Japanese detection + routing — MET.** `detectLanguage`
   (`src/services/translationService.ts:38-62`): any kana in
   U+3040–U+30FF / U+31F0–U+31FF → `ja` (correct hiragana + katakana +
   phonetic-extension ranges, checked before the CJK branch so ja/zh are
   properly distinguished); CJK ratio ≥ 0.3 → `zh`; ASCII ratio ≥ 0.7 → `en`;
   else `unknown` (fail-safe, never translated). `needsTranslation` translates
   only on a detected mismatch — matching text is never sent.
3. **Single endpoint constant, no keys — MET.** `TRANSLATION_ENDPOINT =
   '/.netlify/functions/genai-proxy'` is the one exported constant
   (`translationService.ts:20`); the request body (`prompt`, whitelisted
   `model`, `temperature`) matches the proxy's actual contract in
   `netlify/functions/genai-proxy.js`, and the `{text}` response shape matches.
   No API keys anywhere in the diff; no direct provider calls.
4. **Failure / local-Vite fallback — MET.** `isLocalVite()` (same port set as
   `geminiAdapter.ts`) short-circuits to the original text; non-ok response,
   empty result, and thrown fetch all resolve to the original text;
   `translateLogText` never throws. `LogMessage` renders the base text
   immediately and only swaps in the translation when it resolves — rendering
   is never blocked.
5. **Per-log-id cache dedup — MET.** Module-level cache keyed
   `${logId}:${language}` plus an in-flight promise map
   (`translationService.ts:76-131`). Tests prove fetch counts: sequential
   dedup, concurrent (Promise.all) dedup, distinct ids fetch separately, and
   failures are cached so a dead proxy is not re-hammered.
6. **Bilingual fields for system messages — MET.** `pickLogText` selects
   `translation` (zh) vs `message` (en) — matches the repo convention verified
   in `useGameState.ts` log construction. `LogMessage` skips AI translation
   entirely for `log.isSystem`; vote-record entries carrying bilingual fields
   follow the toggle with zero AI calls.
7. **Test coverage of required scenarios — MET.** Toggle persistence
   (save/load/invalid value/no localStorage), detection routing (ja/zh/en/
   unknown, zh↔en mismatch), failure fallback (throw / non-ok / empty),
   cache dedup by fetch-count (sequential + concurrent + distinct ids),
   local-Vite no-fetch guard, bilingual-field selection. 25 new tests.
8. **test:run + build pass, zero regressions — MET.** Reproduced by the
   debugger: 72/72, build success, no pre-existing test modified or failing.

## Defect review

- **Async/race safety:** `LogMessage` useEffect resets state on
  `log.id`/`baseText`/`language` change and uses a `cancelled` cleanup flag —
  no setState-on-unmounted, no stale-translation flash. OK.
- **XSS:** no `dangerouslySetInnerHTML` anywhere; text rendered as JSX text
  nodes. OK.
- **Human player speech:** goes through the same display-only path (e.g.
  Chinese input shown translated when display=en, with "Show original"
  affordance). Consistent, display-only, does not touch stored log data. OK.
- **"View original" affordance:** present (`LogMessage.tsx:38-49`), only shown
  after a real translation was applied; `stopPropagation` avoids bubble-click
  side effects.

Low-severity observations (no fix required for this card):

- `useGameState.ts` still exports now-unused `translateEnabled`/`visibleText`
  — correctly left alone (file is off-limits); follow-up cleanup card
  recommended, as the coder report also notes.
- `isLocalVite` is duplicated from `geminiAdapter.ts` (not exported there,
  file out of scope) — acceptable; consolidate whenever that file is next open.
- Pure-kanji Japanese (no kana) would detect as `zh` — inherent limit of the
  kana heuristic the card itself prescribes; fail-safe direction.

## Verdict rationale

No scope violations, verification reproduced clean (72/72 tests, successful
build), all 8 acceptance criteria met with evidence, no high-severity defects.

VERDICT: PASS
