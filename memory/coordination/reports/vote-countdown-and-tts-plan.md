# Planning Report: vote-countdown-and-tts

**Role:** $aiwerewolf-planner
**Date:** 2026-07-17
**Requirement slug:** vote-countdown-and-tts

## Cards created

1. `memory/coordination/tasks/vote-countdown-diagnosis-and-fix.md`
2. `memory/coordination/tasks/browser-tts-mvp.md`
3. `memory/coordination/tasks/cloud-tts-adapter-spike.md`

## Queue order and wave grouping

| Wave | Cards | Rationale |
|---|---|---|
| A (parallel) | `vote-countdown-diagnosis-and-fix`, `cloud-tts-adapter-spike` | Countdown card touches `src/hooks/useGameState.ts` + `src/App.tsx` + one new test file. Spike touches ONLY `memory/coordination/reports/cloud-tts-adapter-spike*` — zero product paths, zero overlap. Safe to run concurrently. |
| B (alone) | `browser-tts-mvp` | Runs AFTER wave A card 1 is Accepted. If the spike is still running it may continue in parallel (still zero path overlap). |

### Overlap analysis (why cards 1 and 2 are SEQUENTIAL)

Both the countdown card and the TTS card necessarily edit the same two files:

- `src/hooks/useGameState.ts` — countdown adds vote-deadline state/effects near
  the existing timer effects; TTS wires speech enqueue into `handleDiscussion`
  and lifecycle cancels. Same file, adjacent regions.
- `src/App.tsx` — countdown adds a timer pill in the same header/board area
  where TTS extends the mute button and adds audio controls (~line 221 and the
  timer-pill block ~275–281 are close together).

Per WORKFLOW.md a parallel wave requires non-overlapping allowed paths, so
they cannot share a wave. Countdown goes first because it is the smaller,
lower-risk P0-style fix, and because `browser-tts-mvp`'s optional last-3s
countdown tick sound depends on the vote-countdown state existing.
`browser-tts-mvp`'s card declares this dependency explicitly.

## Dependency on the in-review roster-fix card

`ai-speech-roster-name-fix` is currently **Ready for review** (309 passed / 5
skipped in its worktree). It adds `src/services/rosterGuard.ts` and changes
`aiOrchestrator` / `translationService` / corpus data — none of which overlap
the countdown card's paths, so wave A can start immediately regardless of its
review outcome.

However, `browser-tts-mvp` MUST speak the final roster-guarded displayed text.
Two consequences:

1. **Integration order:** integrate `ai-speech-roster-name-fix` (if PASS)
   before dispatching `browser-tts-mvp`, so the coder's worktree HEAD includes
   `rosterGuard.ts` and the guarded `addLog` path. The TTS card states this
   and instructs the coordinator to adjust at dispatch if the roster card is
   rejected (TTS then reads whatever `visibleText` renders — the card's
   invariant is "speak exactly the final displayed text", which is stable
   under either outcome, but the intended baseline is post-roster-fix).
2. **Test baseline:** all three cards write "309+ (or current baseline)" in
   verification, since the roster fix moves the count from 278 to 309 and the
   exact number at dispatch depends on integration timing.

## Risks

- **Countdown/finishVote race (card 1):** `finishVote` is async and the
  `isProcessingAI` lock is set inside `runAIPhaseSafely` — a timeout firing in
  the same tick as a click could double-resolve. The card makes the
  synchronous deadline-clear + single-`finishVote` guarantee an explicit
  acceptance criterion with a dedicated race test.
- **Timer idiom deviation (card 1):** repo timers are decrement-only
  setIntervals; the card keeps the UI-facing `number | null` state (repo
  consistency) but derives it from an injectable-clock deadline for
  background-tab/Strict-Mode correctness. This is a deliberate, documented
  deviation limited to the new timer; the existing speech/wolf timers are
  frozen out of scope.
- **jsdom-free testing of an audio service (card 2):** repo convention bans
  jsdom/@testing-library. The card requires the service to accept an injected
  mock `speechSynthesis`, keeping the queue/dedupe/fallback logic testable as
  pure-ish units. Real audio behavior is covered by the mandatory Chrome
  checklist the coordinator runs at integration.
- **Voice availability variance (card 2):** installed voices differ by
  OS/browser; deterministic playerId→voice mapping must fall back gracefully.
  Flagged as a residual risk for the report, not solvable offline.
- **Spike honesty (card 3):** aicodemirror/deepseek may simply not document
  TTS. The card forbids name-based guessing and mandates sourced claims or
  "尚未确认"; verification includes a `git status` proof that no product code
  changed.
- **Scope creep magnets:** countdown tick sound (card 2) and Google Cloud TTS
  depth (card 3) are explicitly bounded as optional/report-only.

## Dependencies summary

- `vote-countdown-diagnosis-and-fix`: none.
- `cloud-tts-adapter-spike`: none (reads other cards, ships no code).
- `browser-tts-mvp`: `vote-countdown-diagnosis-and-fix` (path overlap + tick
  hook) and `ai-speech-roster-name-fix` integration (final-text baseline).

## Recommendation to coordinator

Dispatch wave A now (2 workers). Review/integrate the roster-fix card during
wave A. Dispatch `browser-tts-mvp` once the countdown card is Accepted and the
roster fix is integrated (or its rejection is recorded). Run the Chrome
verification checklist from the TTS report before requesting owner deploy
approval.
