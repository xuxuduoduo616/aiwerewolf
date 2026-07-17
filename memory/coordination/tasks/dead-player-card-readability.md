# Task: dead-player-card-readability

## Status

Accepted (2026-07-16, wave 1 cycle 6)

## Objective

Lighten the dead-player card styling so the player's name and seat number stay
legible while the card still reads as "dead".

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/ui-audit-cycle1.md` (issue V01)

## Context

- `src/components/PlayerCard.tsx` line 59 applies
  `opacity-60 grayscale brightness-[0.5]` to dead players. On the dark board
  background (`bg-zinc-900/78` card on zinc-950 scene) this makes name, number,
  and role badge near-illegible; only the red OUT label survives (audit V01).
- **Owner-specified replacement:** `opacity-75 brightness-[0.65]` (the
  `grayscale` class is dropped). The `border-zinc-800` on the same line and the
  skull overlay / OUT label markup stay as they are.
- This is a one-line CSS class change. No component logic, props, or other
  styling may change.
- **Testing:** repo has no DOM tests; a unit test adds no value for a Tailwind
  class literal. Verification is `npm run test:run` (no regressions) +
  `npm run build`. Include a before/after note in the report; the debugger and
  coordinator will confirm visually in the browser QA pass.
- Dependencies: none.
- Parallel wave: wave 1, alongside `speech-timer-autoskip-fix`,
  `action-bar-i18n`, `lobby-difficulty-i18n`, `speech-input-placeholder-i18n`
  (no file overlap — this is the only wave-1 card touching `PlayerCard.tsx`).

## Allowed changes

- `src/components/PlayerCard.tsx` (line 59 dead-state classes only)

## Do not change

- Any other PlayerCard styling, props, badges (wolf teammate, AI model, 无票),
  skull overlay, OUT label, or component logic.
- `src/App.tsx`, other components, hooks.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. Dead player cards use `opacity-75 brightness-[0.65]` (no `grayscale`);
   alive-card, selected, and speaking styles are untouched.
2. Name and seat number of dead players are legible against the dark board
   (visual check noted in the report).
3. Baseline 231 tests still pass; zero regressions.
4. `npm run build` succeeds.

## Verification

```bash
npm run test:run   # baseline 231 pass, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/dead-player-card-readability.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
