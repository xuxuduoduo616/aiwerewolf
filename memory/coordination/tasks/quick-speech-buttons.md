# Task: quick-speech-buttons

## Status

Queued

## Objective

Add NetEase-style preset quick-speech buttons above the free-text input during
the human speech phase, including "X号" templates that autofill a tapped
player's number, language-aware (zh/en).

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/ui-audit-cycle1.md` (issues M02, F04)
- `memory/coordination/tasks/speech-input-placeholder-i18n.md` (wave-1 card
  that already touched `SpeechInput.tsx` — build on its integrated result)

## Context

- Today `src/components/SpeechInput.tsx` is a bare text input + send button
  (audit M02/F04). NetEase provides preset quick phrases — critical for fast
  play.
- **Preset list** (7 presets, per language; `needsTarget` marks "X号" templates):
  | zh | en | needsTarget | tone |
  |---|---|---|---|
  | 过 | Pass | no | neutral |
  | 我是好人 | I'm a villager | no | defend |
  | 我听发言 | Let me listen | no | neutral |
  | X号铁狼 | Player X is wolf | yes | suspicion |
  | X号有问题 | Player X is suspicious | yes | suspicion |
  | X号像好人 | Player X seems good | yes | defend |
  | 我信X号 | I trust Player X | yes | defend |
  Build them via a pure exported helper (e.g.
  `buildQuickSpeeches(language: DisplayLanguage): QuickSpeechPreset[]`) so the
  list is testable; keep the `tone` tag in the data so role-based filtering can
  be added later without redesign (do NOT implement role filtering now — the
  list is role-neutral in this card).
- **Interaction:**
  - Buttons render in a wrap row ABOVE the existing input, only when the input
    is visible (human's turn in DAY_DISCUSSION). Free-text input stays.
  - Non-target preset click → fill the input via the existing `onChange` (user
    can edit, then send with the existing button/Enter). Do not auto-submit.
  - Target preset click → if a valid target is already selected, fill
    immediately; otherwise arm a local "pending template" state and show hint
    text ("点击一名玩家卡片填入号码" / "Tap a player card to fill in the
    number"); when the selected player changes, apply the template (e.g.
    `3号铁狼` / `Player 3 is wolf`) into the input and clear pending state.
    Ignore the human's own card (id 1) as a fill target.
  - Template application is a pure exported helper (e.g.
    `applyQuickTemplate(preset, playerId)`), unit-testable.
- **Wiring:** player-card taps already call `game.setSelectedPlayerId` in
  `App.tsx`; `game.selectedPlayer` is derived in the hook. Pass
  `selectedPlayer` (and anything else needed) into `SpeechInput` at the render
  site `src/App.tsx` lines 307–311. Pending-template state lives locally in
  `SpeechInput`. Language via the `useDisplayLanguage()` hook (same pattern as
  the wave-1 placeholder card) — safe since language is fixed during a game.
- `src/hooks/useGameState.ts` changes are likely UNNECESSARY (`userInput` /
  `setUserInput` / `selectedPlayer` already exist and are passed as props);
  it is in allowed changes only if a real need appears — justify in the report.
- **App.tsx region confinement:** restrict your `App.tsx` diff to the
  SpeechInput render block (~lines 307–311). Another wave-2 card
  (`header-icon-tooltips`) edits the header block of the same file; patches are
  integrated sequentially by the coordinator.
- **Repo test convention:** no jsdom — test the pure helpers only.
- Dependencies: `speech-input-placeholder-i18n` (accepted; same file).
- Parallel wave: wave 2, alongside `header-icon-tooltips` (different `App.tsx`
  regions, otherwise disjoint files).

## Allowed changes

- `src/components/SpeechInput.tsx`
- `src/App.tsx` (ONLY the SpeechInput render block, ~lines 307–311)
- `src/hooks/useGameState.ts` (only if genuinely required — justify)
- New test file, e.g. `src/components/quickSpeech.test.ts`

## Do not change

- Existing free-text submit flow (`handleHumanSpeechSubmit`,
  `normalizeHumanSpeech`), speech timer, speaking queue.
- `App.tsx` outside the SpeechInput render block (header, seat stage, sidebar).
- `src/i18n/index.ts`, `PlayerCard.tsx`, `ActionBar.tsx`, AI layer.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. During the human's speech turn, 7 preset buttons render above the input in
   the current display language; they are absent whenever the input is hidden.
2. Clicking a non-target preset fills the input with its text (no
   auto-submit); the user can edit and send normally.
3. Clicking a target preset with no target selected shows the hint text and
   fills the input once a player card (not the human's own) is tapped; with a
   valid target already selected it fills immediately. Pending state clears
   after fill.
4. Filled templates substitute the real seat number (`3号铁狼` /
   `Player 3 is wolf`).
5. zh and en preset sets are complete and correct per the table above.
6. New unit tests cover `buildQuickSpeeches` (both languages, needsTarget
   flags) and `applyQuickTemplate` (zh and en substitution).
7. Baseline tests still pass plus the new tests; zero regressions.
8. `npm run build` succeeds.

## Verification

```bash
npm run test:run   # baseline pass + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/quick-speech-buttons.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
