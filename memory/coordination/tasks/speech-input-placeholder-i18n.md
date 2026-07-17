# Task: speech-input-placeholder-i18n

## Status

Accepted (2026-07-16, wave 1 cycle 6)

## Objective

Make the SpeechInput placeholder language-aware: "轮到你发言..." in zh mode,
"Your turn to speak..." in en mode.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/ui-audit-cycle1.md` (issues F04 placeholder part, A02)

## Context

- `src/components/SpeechInput.tsx` line 22 hardcodes `placeholder="轮到你发言..."`
  regardless of display language (audit A02).
- **Language source:** read the language inside SpeechInput via the existing
  `useDisplayLanguage()` hook from `src/i18n/index.ts` — keeps the card
  isolated to `SpeechInput.tsx` (no `App.tsx` prop change). Safe because cycle
  5 made the lobby the sole language authority: display language cannot change
  mid-game.
- **Strings:** zh `轮到你发言...`, en `Your turn to speak...`.
- **Repo test convention:** no jsdom. Export a pure helper (e.g.
  `export const speechPlaceholder = (language: DisplayLanguage): string`) and
  unit-test it; keep the component change minimal.
- Note for the coordinator's sequencing: `quick-speech-buttons` (wave 2) also
  rewrites `SpeechInput.tsx` — this card must be integrated first; the wave-2
  worker will build on the integrated result.
- Dependencies: none.
- Parallel wave: wave 1, alongside `speech-timer-autoskip-fix`,
  `action-bar-i18n`, `lobby-difficulty-i18n`, `dead-player-card-readability`
  (no file overlap — only wave-1 card touching `SpeechInput.tsx`).

## Allowed changes

- `src/components/SpeechInput.tsx`
- New test file, e.g. `src/components/SpeechInput.test.ts`

## Do not change

- SpeechInput's existing props contract (`value`, `onChange`, `onSubmit`,
  `visible`), Enter-to-submit behavior, styling, send button.
- `src/App.tsx`, `src/i18n/index.ts`, hooks, other components.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. Placeholder renders "轮到你发言..." when display language is `zh` and
   "Your turn to speak..." when `en`.
2. No other behavior or visual change to SpeechInput.
3. New unit tests cover the placeholder helper for both languages.
4. Baseline 231 tests still pass plus the new tests; zero regressions.
5. `npm run build` succeeds.

## Verification

```bash
npm run test:run   # baseline 231 pass + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/speech-input-placeholder-i18n.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
