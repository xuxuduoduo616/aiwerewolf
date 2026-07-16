# Task: night-pipeline-exception-safety

## Status

Accepted

## Objective

Fix the permanent "AI正在思考局势..." stall: any exception thrown inside an
async handler between `setIsProcessingAI(true)` and `setIsProcessingAI(false)`
wedges the game forever (the phase driver blocks while `isProcessingAI`).
Harden every such block with try/finally, guard the un-caught dynamic imports
in the AI layer, and add fetch timeouts so production cannot hang on a dead
network path.

## Required reading

- `memory/coordination/PROJECT_STATE.md`
- `src/hooks/useGameState.ts` — handleWerewolfPhase, handleSeerPhase,
  handleWitchPhase, handleDiscussion, finishVote (all set isProcessingAI
  with awaits in between and NO exception safety)
- `src/ai/aiOrchestrator.ts` — lines 43–51: `await import('./geminiAdapter')`
  is NOT wrapped in try/catch; if the dynamic import rejects (Vite dev module
  invalidation, stale production chunk after redeploy) the whole
  generateAIDialogue/generateAIAction/generateWolfChat promise rejects
- `src/ai/geminiAdapter.ts` — `fetch` calls have no timeout

## Context

- User-reported bug: human werewolf, 9p easy mode, after locking the night
  kill the game stalled forever on the isProcessingAI spinner.
- Root cause class: unhandled rejection inside an isProcessingAI block. The
  most likely trigger on dev was dynamic-import invalidation; on production
  the same wedge occurs when a redeploy invalidates old hashed chunks.
- Scope boundary: exception-safety only. Do NOT redesign the phase machine,
  vote logic, or AI decision logic.
- Dependencies: none. Parallel wave: runs ALONE.

## Allowed changes

- `src/hooks/useGameState.ts` — try/finally around isProcessingAI blocks;
  on error, log a system line and advance to the phase the success path
  would set (safe defaults), never leave the phase machine stuck
- `src/ai/aiOrchestrator.ts` — guard the dynamic geminiAdapter imports with
  try/catch returning the null/empty results the fallback layers expect
- `src/ai/geminiAdapter.ts` — add `AbortSignal.timeout(12000)` (or equivalent
  guarded implementation) to fetch calls; keep '' -on-failure contract
- Test files for the above

## Do not change

- Phase machine ordering, vote tally logic, AI decision logic
- gameEngine.ts, beliefTracker, actionSelector
- Unrelated code, other task cards, PROJECT_STATE.md
- Git branches, commits, merges, worktree configuration

## Acceptance criteria

1. Every `setIsProcessingAI(true)` block in useGameState.ts resets to false
   on BOTH success and thrown exception (try/finally), and the phase still
   advances (or safely re-enters) after an error — the game can never wedge.
2. aiOrchestrator survives a rejecting dynamic import: generateAIDialogue
   falls back to the speech library/hardcoded layer; generateAIAction falls
   back to the Layer-1 decision; generateWolfChat falls back to library lines.
3. geminiAdapter fetches abort after a bounded timeout and return ''.
4. New tests simulate a rejecting LLM/import path and assert (a) no unhandled
   rejection, (b) isProcessingAI resets, (c) a fallback result is produced.
5. Zero regressions: `npm run test:run` (baseline 205) and `npm run build` pass.

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/night-pipeline-exception-safety.md`
- Verdict: PASS/FAIL with reproduction steps and test results.
