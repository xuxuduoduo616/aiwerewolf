# Task: language-switch-and-ai-translation

## Status

Accepted

## Objective

Add a display-layer language switch (zh/en) with persistence and a translation service that translates mismatched-language AI speeches (frequently Japanese, from the AIWolf corpus) into the selected display language via the existing server proxy — caching per log entry, never blocking game flow, and never touching game logic.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `src/types.ts` (GameLog entry shape — it already has `message`/`translation` bilingual fields; investigate before deciding the exact rendering shape)
- `src/App.tsx` (game header + log rendering)
- `src/ai/geminiAdapter.ts` (how the frontend calls the server proxy today, incl. local-Vite no-network guard)

## Context

- **Parallel wave: Wave 1** (may run concurrently with `provider-adapter-refactor`, `role-behavior-distillation`, `ai-role-evaluation` — non-overlapping paths).
- Dependencies: `none`.
- Why: speech library files are mixed EN/JA/CN from the AIWolf corpus, so AI speech often appears in Japanese. This card translates DISPLAY only — speech GENERATION in `aiOrchestrator` is out of scope.
- **`src/i18n/` module (new)**: language state (`zh` / `en` at minimum), persisted to localStorage, retained across a game.
- **Toggle**: a visible language toggle button in the game header/UI in `src/App.tsx`.
- **`src/services/translationService.ts` (new)**:
  - (a) Detect whether a speech's language already matches the display language. Use a CJK-ratio heuristic for zh, and Japanese kana (hiragana/katakana) detection to distinguish ja from zh.
  - (b) On mismatch, request translation through the SERVER adapter endpoint. Today that is `/.netlify/functions/genai-proxy` — define the endpoint path as ONE constant so it can be switched to `provider-adapter` later with a one-line change.
  - (c) Cache by log-entry id so a speech is never translated twice.
  - (d) On failure or in local Vite dev (see `isLocalVite` pattern in `geminiAdapter.ts`), return the original text — translation must NEVER block or delay game flow.
- Optional "view original" affordance on translated entries.
- System messages and vote summaries follow the display language wherever they already carry the existing bilingual fields — reuse those fields; do not re-translate them.
- Architecture rule: display layer only. Game state, votes, roles, phase logic are NOT touched.
- Scope boundary: `useGameState.ts` logic, `gameEngine.ts`, and `aiOrchestrator` speech generation are strictly off-limits.
- Do not put any API keys anywhere — the server proxy owns keys.

## Allowed changes

- `src/i18n/**` — new
- `src/services/translationService.ts` — new
- `src/App.tsx` — toggle button + log display wiring ONLY
- `src/components/**` — only if a small display component is needed
- Test files for the above

## Do not change

- `src/hooks/useGameState.ts` logic, `src/gameEngine.ts`, `src/ai/aiOrchestrator.ts` (speech generation), `src/ai/beliefTracker.ts`, `src/ai/actionSelector.ts`.
- Netlify functions.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. A language toggle (zh/en) is visible in the game UI; the choice persists via localStorage and survives reload.
2. Japanese speech text is detected (kana heuristic) and routed for translation when the display language is zh or en; text already in the display language is not translated.
3. Translation goes through one endpoint-path constant pointing at the server proxy; no direct provider calls, no keys in frontend.
4. Translation failure (or local Vite dev) falls back to the original text without blocking rendering.
5. Cache by log-entry id prevents duplicate translation requests (proven by test counting fetch calls).
6. System messages and vote summaries follow the display language via the existing bilingual fields.
7. Tests cover: toggle persistence, language detection routing, failure fallback, cache dedup, bilingual-field display.
8. `npm run test:run` and `npm run build` pass with zero regressions (baseline 55/55).

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/language-switch-and-ai-translation.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
