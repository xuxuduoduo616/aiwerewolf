# Task: action-bar-i18n

## Status

Accepted (2026-07-16, wave 1 cycle 6)

## Objective

Localize all ActionBar button labels (currently hardcoded English) so they
render in Chinese when the display language is `zh` and in English when `en`.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/ui-audit-cycle1.md` (issues F03, A01)

## Context

- `src/components/ActionBar.tsx` lines 34–55 hardcode English button text:
  KILL, CHECK, SAVE, POISON, PASS, VOTE, NO VOTE (and SHOOT at line 48). In a
  Chinese game the phase hints and role text are Chinese while buttons are
  English — jarring mismatch (audit F03/A01).
- **Required labels** (owner-specified):
  | key | zh | en |
  |---|---|---|
  | KILL | 刀人 | KILL |
  | CHECK | 查验 | CHECK |
  | SAVE | 救人 | SAVE |
  | POISON | 毒药 | POISON |
  | PASS | 跳过 | PASS |
  | SHOOT | 开枪 | SHOOT |
  | VOTE | 投票 | VOTE |
  | NO VOTE | 弃票 | NO VOTE |
- **Language source:** read the language inside ActionBar via the existing
  `useDisplayLanguage()` hook from `src/i18n/index.ts` — this keeps the card
  isolated to `ActionBar.tsx` (no `App.tsx` prop change). This is safe because
  cycle 5 made the lobby the sole language authority: the display language
  cannot change mid-game, so it equals the game language during play.
- **Repo test convention:** no jsdom/@testing-library. Export a pure label
  helper/map (e.g. `export const actionLabel = (key: ActionLabelKey, language: DisplayLanguage): string`)
  from `ActionBar.tsx` and unit-test it in node env (mirror
  `src/components/PlayerCard.wolfvision.test.ts` style).
- Icons (`lucide-react`), disabled logic, click handlers, and CSS classes must
  stay exactly as they are — text labels only.
- Dependencies: none.
- Parallel wave: wave 1, alongside `speech-timer-autoskip-fix`,
  `lobby-difficulty-i18n`, `dead-player-card-readability`,
  `speech-input-placeholder-i18n` (no file overlap).

## Allowed changes

- `src/components/ActionBar.tsx`
- New test file, e.g. `src/components/ActionBar.test.ts`

## Do not change

- `src/App.tsx`, `src/i18n/index.ts`, `src/hooks/useGameState.ts`, other
  components.
- ActionBar's props contract, button enable/disable logic, handlers, icons,
  styling.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. With display language `zh`, all eight buttons render the Chinese labels
   above; with `en`, the existing English labels are unchanged.
2. No behavior change: enable/disable conditions, handlers, icons, and CSS
   classes identical to today.
3. New unit tests cover the exported label helper for every key in both
   languages (16 assertions or table-driven equivalent).
4. Baseline 231 tests still pass plus the new tests; zero regressions.
5. `npm run build` succeeds.

## Verification

```bash
npm run test:run   # baseline 231 pass + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/action-bar-i18n.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
