# Report: night-pipeline-exception-safety

**Role:** CODER (Claude)
**Worktree:** `/Users/frank/aiwerewolf/.claude/worktrees/agent-a1c0c373e28bc3bac` (fast-forwarded b7a8529 → 73e2934 before work)
**Patch:** `memory/coordination/runs/night-pipeline-exception-safety-claude.patch`
**Verdict:** PASS — 216/216 tests (baseline 205 + 11 new), production build succeeds.

## Root cause

Owner-reported stall (human werewolf, 9p: permanent "AI正在思考局势..." spinner
after locking the night kill). Three compounding gaps:

1. `src/hooks/useGameState.ts` — `handleWerewolfPhase`, `handleSeerPhase`,
   `handleWitchPhase`, `handleDiscussion`, `finishVote` all set
   `isProcessingAI=true`, awaited AI calls, then set `false` with NO
   try/finally. Any rejection left the flag stuck `true`; the phase driver
   (`if (winner || !players.length || isProcessingAI) return;`) then
   early-returned forever — a permanent wedge. In the reported game the human
   locked the kill → `NIGHT_SEER` → `handleSeerPhase` raised the flag and its
   `generateAIAction` await rejected.
2. `src/ai/aiOrchestrator.ts` — the `await import('./geminiAdapter')` calls
   were un-guarded. A rejecting dynamic import (Vite dev module invalidation;
   stale hashed chunk after a production redeploy) rejected the whole
   `generateAIDialogue` / `generateAIAction` / `generateWolfChat` promise,
   bypassing the intended Gemini → library → hardcoded fallback design.
3. `src/ai/geminiAdapter.ts` — fetches had no timeout, so a dead network path
   could hang an isProcessingAI block indefinitely.

Additional wedge vector found and fixed: `handleWerewolfPhase` awaits
`generateWolfChat` BEFORE raising `isProcessingAI`. A rejection there aborted
the handler with no state change, so the driver effect never re-fired
(dependencies unchanged) — also a permanent stall for an all-AI wolf team.

## Fix design (minimal diff, three layers)

### 1. `src/hooks/useGameState.ts`

- New exported helper `runAIPhaseSafely(setProcessing, task, onError)`:
  raises the flag synchronously (preserves the driver double-fire guard that
  `deadPlayerVoteAutoresolve.test.ts` documents for `finishVote`), awaits the
  task in try/catch, ALWAYS resets the flag in `finally`, never rejects.
- All five handlers now run their awaited section through it; the phase
  advance moved to after the awaited call so it runs on BOTH success and
  error (identical ordering to the old success path: flag reset, then phase).
  Safe default actions on error, each with a bilingual system log line:
  - Werewolf: fallback kill target = first living non-wolf (the same fallback
    the success path already used) → `NIGHT_SEER`.
  - Seer: check skipped → `NIGHT_WITCH`.
  - Witch: potions unused → `DAY_ANNOUNCE`.
  - Discussion: speaker's turn skipped → `setCurrentSpeaker(null)`.
  - finishVote: per-AI-voter try/catch counts a failed vote as abstain (tally
    keeps moving); the outer guard logs and advances to `NIGHT_START` if the
    tally section itself throws. The six scattered
    `setIsProcessingAI(false)` calls before early returns were replaced by
    the single `finally` (React 18 batches these updates in the same
    continuation — no observable ordering change). GAME_OVER /
    DAY_HUNTER_SHOT early-return paths are unchanged.
- `generateWolfChat` pre-flag await wrapped in try/catch (wolf chat is
  cosmetic; must never block the night).
- Phase ordering, vote tally, and AI decision logic untouched.

### 2. `src/ai/aiOrchestrator.ts`

Both dynamic-import wrappers (`generateSpeechWithLLM`,
`generateActionWithLLM`) wrapped in try/catch returning the exact values the
existing fallback layers already branch on (`null` and `{ targetId: null }`).
A chunk-load failure now degrades to the library/hardcoded layer by design.

### 3. `src/ai/geminiAdapter.ts`

`postForText` passes `signal: timeoutSignal()` where `timeoutSignal()`
returns `AbortSignal.timeout(12000)`, guarded by
`typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'`
(older browsers get no signal, previous behavior). Timeout aborts land in the
existing catch → `''` contract preserved (adapter → proxy → '' → library).

## Tests

New `src/nightPipelineExceptionSafety.test.ts` (8 tests), following the
`deadPlayerVoteAutoresolve.test.ts` pattern (node env, no hook rendering):

- `runAIPhaseSafely`: rejecting task → resolves (no unhandled rejection),
  flag transitions `[true, false]`, error reported; success path clean; flag
  raised synchronously; faithful `handleSeerPhase` simulation shows a
  rejecting AI call still unblocks the driver and advances the phase.
- aiOrchestrator under `vi.mock('./ai/geminiAdapter', () => { throw ... })`
  (simulates the real chunk-load rejection): `generateAIAction` KILL/VOTE
  return valid fallback targets, `generateAIDialogue` returns non-empty
  fallback speech, `generateWolfChat` returns 1–3 library/hardcoded lines
  from wolf speakers.

Extended `src/ai/geminiAdapter.test.ts` (+3 tests): every fetch carries an
`AbortSignal` created via `AbortSignal.timeout(12000)`; signal omitted when
`AbortSignal.timeout` is unavailable; timeout abort returns `''`.

## Verification

- `npm run test:run`: **216 passed / 216** (20 files) — baseline 205 + 11 new,
  zero regressions.
- `npm run build`: tsc + Vite production build succeeded.
- `git status --short`: only the 4 allowed source files + 1 new test file
  (patch regenerated after unstaging incidental `dist/` build output;
  node_modules symlink never staged).

## Risks

- `finishVote` consolidates flag resets into one `finally`; relies on React 18
  auto-batching for identical observable behavior (verified reasoning above,
  covered indirectly by the driver double-fire test suite).
- On an unexpected mid-tally exception in `finishVote`, the round's votes may
  not be recorded and the game moves to night — deliberate safe default per
  the card ("never leave the machine stuck").
