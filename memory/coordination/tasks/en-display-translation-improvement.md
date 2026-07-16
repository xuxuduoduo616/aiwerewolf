# Task: en-display-translation-improvement

## Status

Accepted

## Objective

Display-layer polish: in EN display mode, when a log entry's English field is the known canned fallback stub (or missing) while a Chinese original exists, `LogMessage` must translate the zh original via `translationService` (same cache/fallback rules; local dev shows the zh original) instead of showing the stub, with the existing "view original" affordance for this path.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/browser-verification-cycle2.md` (section A, design note)

## Context

- **QA evidence (cycle 2, section A)**: in EN display mode, fallback AI speeches show the canned English stubs `'Speaks based on game situation.'` and `'Pushes suspicion on Player N.'` instead of any real content, and no "view original" affordance exists for that path.
- **Why**: logs are bilingual by convention (`message` = English, `translation` = Chinese; `pickLogText` in `src/i18n/index.ts`). The local AI fallback fills the `en` field with a generic summary (`src/ai/aiOrchestrator.ts:133` — `'Speaks based on game situation.'` — and `:314` — `` `Pushes suspicion on Player ${suspect?.id || '?'}.` ``), while the `zh` field carries the real speech. `LogMessage` (`src/components/LogMessage.tsx`) only translates when `needsTranslation(baseText, language)` mismatches — an English stub in EN mode never mismatches, so the stub is displayed as-is.
- **Fix direction (display layer only)**: when `language === 'en'` and the log is a non-system speech whose `message` is one of the known canned stubs (or missing) while `log.translation` (zh original) exists, use the zh original as the translation source: request `translateLogText(log.id, zhOriginal, 'en')` with the existing cache/fallback rules. On local dev (proxy unavailable) or failure, `translateLogText` returns the source unchanged — show the zh original rather than the stub. The existing "view original" toggle in `LogMessage` should apply to this path (translated EN ↔ zh original), consistent with current behavior.
- Stub detection must match the exact known stubs (including the `Pushes suspicion on Player N.` pattern with variable player id); keep it narrow so genuine English speeches are never overridden.
- If a small helper is needed (e.g. stub detection or a source-selection function), it may live in `src/i18n/index.ts` or `src/services/translationService.ts` — reuse before creating.
- **Scope boundary**: display layer only. The bilingual log fields, the fallback generator, and game state are untouched — do NOT touch `aiOrchestrator` or `useGameState`.
- **Dependencies**: none.
- **Parallel wave**: wave 3 — may run concurrently with `dead-player-vote-autoresolve` and `speech-quality-filter` (non-overlapping paths).

## Allowed changes

- `src/components/LogMessage.tsx`
- `src/i18n/index.ts`
- `src/services/translationService.ts` (only if a helper is genuinely needed)
- Test files (e.g. `src/i18n/i18n.test.ts`, `src/services/translationService.test.ts`, or a new LogMessage test)

## Do not change

- `src/ai/aiOrchestrator.ts` (the stub strings stay where they are) and `src/hooks/useGameState.ts`.
- Log data shape (`GameLog`), log creation, or game state.
- Existing translation cache/fallback semantics in `translateLogText`.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. EN mode, speech log with stub `en` field and real `zh` original: displays a translation of the zh original when the proxy is available; displays the zh original (not the stub) on local dev or translation failure.
2. The "view original" toggle appears for this path and switches between the translated text and the zh original, matching the existing toggle behavior and labels.
3. EN mode logs with genuine English speech text are unaffected (no stub false-positives); zh mode behavior is unchanged.
4. System messages and bilingual vote/system entries are unaffected.
5. Translation requests for this path go through `translateLogText` (same per-log-id cache, no duplicate requests on re-render).
6. Unit tests cover: stub detection (positive and negative cases incl. the `Pushes suspicion on Player N.` pattern), zh-original substitution in EN mode, and unchanged behavior for genuine English text.
7. Baseline 163 tests still pass, plus the new tests; zero regressions.

## Verification

```bash
npm run test:run   # baseline 163 pass + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/en-display-translation-improvement.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
