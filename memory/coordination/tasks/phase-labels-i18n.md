# Task: phase-labels-i18n

## Status

Ready for review

## Objective

Add English phase labels and render the in-game phase name (header +
center console) in the game's language.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/ui-audit-cycle1.md` (issues A04, I02 context)

## Context

- `PHASE_LABELS` in `src/constants.ts` lines 63–76 is Chinese-only (audit A04).
  It renders in `src/App.tsx` at line 216 (game header) and line 272 (center
  console), both as `PHASE_LABELS[game.phase] || game.phase`.
- **Language authority (owner note):** phase labels must use the GAME language
  (`gameLanguage`, snapshotted at `startGame` — cycle 5 lobby-language-authority),
  NOT the lobby `displayLanguage` state. `gameLanguage` lives in
  `src/hooks/useGameState.ts` line 102 but is not currently in the hook's
  return object (lines 739–759) — add it there (additive, one line).
- **Approach:** add `PHASE_LABELS_EN: Record<string, string>` to
  `constants.ts` with the same keys as `PHASE_LABELS`, plus a pure helper
  (e.g. `getPhaseLabel(phase: string, language: DisplayLanguage): string`)
  that falls back to the raw phase key when unmapped (mirroring today's
  `|| game.phase`). Use it at both App render sites with
  `game.gameLanguage`.
- **Suggested EN labels** (adjust wording freely, keep them short):
  LOGIN: Login, LOBBY: Lobby, NIGHT_START: Nightfall,
  NIGHT_WEREWOLVES: Werewolves Hunt, NIGHT_SEER: Seer Checks,
  NIGHT_WITCH: Witch Acts, DAY_ANNOUNCE: Dawn Report,
  DAY_HUNTER_CHECK: Hunter Status, DAY_HUNTER_SHOT: Hunter Shot,
  DAY_DISCUSSION: Day Discussion, DAY_VOTING: Exile Vote,
  GAME_OVER: Game Over.
- zh rendering must stay byte-identical to today (labels from `PHASE_LABELS`).
- **Repo test convention:** no jsdom — unit-test key parity
  (`PHASE_LABELS_EN` covers exactly the `PHASE_LABELS` keys) and
  `getPhaseLabel` (zh pick, en pick, unmapped fallback).
- **Region confinement:** in `App.tsx` touch only the two phase-label
  expressions (lines 216, 272) plus the import line; in `useGameState.ts`
  touch only the return object. `player-card-speaking-status` (next wave)
  edits other regions of the same two files; the coordinator integrates
  sequentially.
- Dependencies: none (wave-1/2 cards touch different concerns; start from the
  then-current HEAD).
- Parallel wave: wave 3, solo (shares `App.tsx` + `useGameState.ts` with
  `player-card-speaking-status`, which runs in wave 4).

## Allowed changes

- `src/constants.ts` (`PHASE_LABELS_EN`, `getPhaseLabel`)
- `src/App.tsx` (ONLY the two phase-label render expressions + import)
- `src/hooks/useGameState.ts` (ONLY exposing `gameLanguage` in the return
  object)
- New test file, e.g. `src/phaseLabels.test.ts`

## Do not change

- `PHASE_LABELS` zh values, `ROLE_LABELS`, `ROLE_DESCRIPTIONS`, any other
  constants.
- Any game logic in `useGameState.ts`; any other part of `App.tsx`.
- `src/i18n/index.ts` semantics.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. In an EN game, the header phase line and the center-console phase name
   render English labels; in a zh game rendering is byte-identical to today.
2. Labels come from `gameLanguage` (hook return), not the lobby
   `displayLanguage` state.
3. Unmapped phases still fall back to the raw phase key.
4. New unit tests cover key parity between `PHASE_LABELS` and
   `PHASE_LABELS_EN` and `getPhaseLabel` behavior for both languages +
   fallback.
5. Baseline tests still pass plus the new tests; zero regressions.
6. `npm run build` succeeds.

## Verification

```bash
npm run test:run   # baseline pass + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/phase-labels-i18n.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
