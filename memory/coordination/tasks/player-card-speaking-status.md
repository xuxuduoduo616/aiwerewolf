# Task: player-card-speaking-status

## Status

Accepted

## Objective

Surface per-player speaking status on the board during day discussion: three
visual states — currently speaking (existing ring + mic), already spoke (green
checkmark badge, slightly dimmer), not yet spoken (default).

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `memory/coordination/reports/ui-audit-cycle1.md` (issues M06, F06)

## Context

- `useGameState.ts` already tracks `speakingQueue` (line 116) and
  `currentSpeaker` (line 117), but nothing records who has FINISHED speaking —
  the board gives no 已发言/未发言 signal (audit M06/F06; NetEase shows badges
  on every card).
- **State (owner-specified):** track `spokenPlayerIds` in
  `src/hooks/useGameState.ts` — the set/array of player ids that finished
  speaking in the current day round. Mark a player spoken at every
  finish point:
  - AI speech completion in `handleDiscussion` (~line 565, including the
    AI-error skip path);
  - human submit in `handleHumanSpeechSubmit` (~lines 657–664);
  - human speech-timer auto-skip effect (~lines 186–191);
  - dead-human skip inside `handleDiscussion` (~lines 539–543).
  Reset once per day cycle (e.g. in `handleDayAnnounce`, before last-words are
  queued) — NOT in `enterDiscussion`, which is re-entered mid-day after a
  hunter shot and must not wipe earlier speakers. Expose `spokenPlayerIds` in
  the hook's return object.
- **PlayerCard:** add optional `hasSpoken?: boolean` prop in
  `src/components/PlayerCard.tsx`. When true (and the player is alive and not
  `isSpeaking`): render a small green checkmark badge (lucide `Check` or
  `CheckCircle2`, styled like the existing badge patterns, e.g. emerald tones;
  `aria-label="已发言"`) and dim the card slightly (subtle, e.g. `opacity-90` —
  clearly weaker than the dead-card dimming). Pick a badge position that does
  not collide with the existing badges: seat number (top-left), 无票
  (top-right), customBadge (avatar top-right), wolf teammate (bottom-left),
  mic (bottom-right).
- **App wiring:** in the seat-stage `PlayerCard` render
  (`src/App.tsx` ~lines 233–252), pass
  `hasSpoken={game.phase === GamePhase.DAY_DISCUSSION && game.spokenPlayerIds.includes(player.id)}`
  (gate to DAY_DISCUSSION so night/vote boards stay unchanged).
- **Repo test convention:** no jsdom. Export a pure status helper (e.g.
  `computeSpeakingStatus(playerId, isAlive, currentSpeakerId, spokenPlayerIds, phase)`
  → `'speaking' | 'spoken' | 'pending' | 'none'`) mirroring the App/PlayerCard
  logic, and unit-test it (pattern: `src/components/PlayerCard.wolfvision.test.ts`,
  `src/deadPlayerVoteAutoresolve.test.ts`).
- **Region confinement:** the wave-3 card `phase-labels-i18n` also touches
  `App.tsx` (phase-label expressions) and the `useGameState.ts` return object;
  this card runs AFTER it is integrated — start from the then-current HEAD and
  keep diffs to the regions above.
- Dependencies: soft — integrate after `phase-labels-i18n` (shared files);
  also lands after `speech-timer-autoskip-fix`, whose auto-skip effect this
  card extends.
- Parallel wave: wave 4, solo.

## Allowed changes

- `src/hooks/useGameState.ts` (`spokenPlayerIds` state + marks/reset + return
  object + pure status helper)
- `src/components/PlayerCard.tsx` (`hasSpoken` prop + badge/dim styling)
- `src/App.tsx` (ONLY the seat-stage PlayerCard props)
- New test file, e.g. `src/speakingStatus.test.ts`

## Do not change

- Speaking-queue construction (`buildSpeakingQueue`), speech-timer duration,
  vote logic, night logic, existing log strings.
- Existing PlayerCard states (dead styling, selected, speaking ring, badges).
- `App.tsx` outside the seat-stage PlayerCard render.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. During DAY_DISCUSSION, players who finished speaking (AI completion, AI
   error skip, human submit, human timer auto-skip, dead-human skip) show the
   green checkmark badge and slight dimming; the current speaker keeps the
   existing ring + mic; players not yet spoken look unchanged.
2. `spokenPlayerIds` resets each new day; a mid-day hunter-shot re-entry into
   discussion does NOT wipe already-spoken marks.
3. Outside DAY_DISCUSSION (night, voting, game over) player cards render
   exactly as today.
4. New unit tests cover the status helper: speaking vs spoken vs pending,
   dead players, non-discussion phases, and the reset/re-entry semantics of
   the tracked set (as far as pure helpers allow).
5. Baseline tests still pass plus the new tests; zero regressions.
6. `npm run build` succeeds.

## Verification

```bash
npm run test:run   # baseline pass + new tests, zero regressions
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/player-card-speaking-status.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
