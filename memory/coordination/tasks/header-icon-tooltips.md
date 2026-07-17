# Task: header-icon-tooltips

## Status

Ready for review

## Objective

Add language-aware `title` and `aria-label` attributes to the two icon-only
buttons in the in-game header (mute toggle, return to lobby).

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/ui-audit-cycle1.md` (issue V02)

## Context

- `src/App.tsx` lines 220–223: the in-game header has two SVG-only buttons
  with no `title`/`aria-label` — users cannot tell what they do without
  clicking (audit V02).
- **Labels** (owner-specified), based on the existing `displayLanguage` state
  already in scope in `App.tsx` (line 26):
  - Mute button: zh `静音/取消静音`, en `Mute / Unmute`
  - Return button: zh `返回大厅`, en `Return to lobby`
- Put `title` and `aria-label` on the `<button>` elements. No behavior,
  styling, or icon changes. The lobby header pill at line 146 already follows
  this `title` pattern — match it.
- **App.tsx region confinement:** restrict the diff to the in-game header
  button block (~lines 220–223). Another wave-2 card (`quick-speech-buttons`)
  edits the SpeechInput render block of the same file; patches are integrated
  sequentially by the coordinator.
- **Testing:** attribute-only JSX change; repo has no DOM test setup, so no
  new test file is required. Verification is the full suite + build; the
  coordinator confirms tooltips in the browser QA pass.
- Dependencies: none.
- Parallel wave: wave 2, alongside `quick-speech-buttons` (different `App.tsx`
  regions).

## Allowed changes

- `src/App.tsx` (ONLY the in-game header buttons, ~lines 220–223)

## Do not change

- Button click handlers, icons, styling; the removed in-game language pill
  must NOT be reintroduced (owner decision, cycle 5).
- `App.tsx` outside the header button block; components; hooks.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. Both header buttons expose `title` and `aria-label` with the exact strings
   above, switching with `displayLanguage`.
2. No behavioral or visual change otherwise; no in-game language toggle added.
3. Baseline tests still pass; zero regressions.
4. `npm run build` succeeds.

## Verification

```bash
npm run test:run   # baseline pass, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/header-icon-tooltips.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
