# Task: lobby-difficulty-i18n

## Status

Accepted (2026-07-16, wave 1 cycle 6)

## Objective

Add English labels and descriptions to the three difficulty configs and render
the lobby difficulty selector in the current display language.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/ui-audit-cycle1.md` (issue A03)

## Context

- **Location correction:** the coordinator brief said `constants.ts`, but
  `DIFFICULTY_CONFIGS` and `DIFFICULTY_LABELS` actually live in
  `src/types.ts` lines 60–108. Edit them there — do not move them.
- `src/App.tsx` renders `DIFFICULTY_CONFIGS[d].label` (line 175) and
  `DIFFICULTY_CONFIGS[game.difficulty].description` (line 179) in the lobby.
  Both are Chinese-only today; an English-mode guest cannot understand the
  difficulty system (audit A03).
- **Required labels:** 新手→Beginner, 进阶→Intermediate, 高手→Expert.
- **English descriptions** (suggested wording; keep meaning equivalent to zh):
  - easy: "AI deliberately exposes logical flaws — ideal for first-time
    werewolf players."
  - normal: "AI uses standard strategy with occasional mistakes — for players
    with some experience."
  - hard: "AI plays near-optimal strategy with realistic speech, hard to tell
    apart — a challenge for veterans."
- **Approach:** add `labelEn: string` and `descriptionEn: string` to the
  `DifficultyConfig` interface and fill all three configs (additive — do not
  rename existing `label`/`description` fields; `DIFFICULTY_CONFIGS[difficulty].actionAccuracy`
  is consumed by `useGameState.ts:274` and must be untouched). In `App.tsx`
  pick label/description based on the existing `displayLanguage` state
  (already in scope at line 26); a small pure picker exported from `types.ts`
  (e.g. `difficultyLabel(config, language)`) keeps it testable.
- **Repo test convention:** no jsdom — unit-test the config data (all three
  difficulties have non-empty `labelEn`/`descriptionEn`, exact label mapping)
  and the picker helper in node env.
- Dependencies: none.
- Parallel wave: wave 1, alongside `speech-timer-autoskip-fix`,
  `action-bar-i18n`, `dead-player-card-readability`,
  `speech-input-placeholder-i18n` (no file overlap — this is the only wave-1
  card touching `App.tsx` and `types.ts`).

## Allowed changes

- `src/types.ts` (`DifficultyConfig` interface + `DIFFICULTY_CONFIGS` /
  `DIFFICULTY_LABELS` additive fields, optional pure picker)
- `src/App.tsx` (lobby difficulty selector rendering only, ~lines 161–180)
- New test file, e.g. `src/difficultyI18n.test.ts`

## Do not change

- Numeric difficulty parameters (`actionAccuracy`, `speechQuality`,
  `wolfCoordination`, `mistakeRate`) or existing zh strings.
- Any other part of `App.tsx` (game view, header, log sidebar).
- `src/hooks/useGameState.ts`, `src/constants.ts`, `src/i18n/index.ts`.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. In the lobby with display language `en`, the three difficulty buttons show
   Beginner / Intermediate / Expert and the description under them is English;
   with `zh`, rendering is byte-identical to today.
2. `DifficultyConfig` gains `labelEn`/`descriptionEn` additively; all existing
   consumers (`useGameState.ts:274`) compile and behave unchanged.
3. New unit tests cover the label mapping (3 difficulties × 2 languages) and
   non-empty English descriptions.
4. Baseline 231 tests still pass plus the new tests; zero regressions.
5. `npm run build` succeeds.

## Verification

```bash
npm run test:run   # baseline 231 pass + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/lobby-difficulty-i18n.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
