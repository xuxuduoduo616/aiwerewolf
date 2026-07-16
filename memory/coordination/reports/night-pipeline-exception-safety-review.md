# Review: night-pipeline-exception-safety

**Role:** DEBUGGER
**Worktree reviewed:** `/Users/frank/aiwerewolf/.claude/worktrees/agent-a1c0c373e28bc3bac` (base 73e2934)
**Patch:** `memory/coordination/runs/night-pipeline-exception-safety-claude.patch`
**Date:** 2026-07-16

## 1. Scope check — PASS

`git status --short` (tracked changes only):

```
M  src/ai/aiOrchestrator.ts
M  src/ai/geminiAdapter.test.ts
M  src/ai/geminiAdapter.ts
M  src/hooks/useGameState.ts
A  src/nightPipelineExceptionSafety.test.ts
```

All five paths are within the card's allowed list (3 allowed sources + test
files). Untracked items are only the coder's report and the node_modules
symlink. `dist/` is gitignored and never staged.

## 2. Patch check — PASS

- `git apply --check` against main repo HEAD (73e2934): clean, no conflicts.
- Zero `dist/` hunks in the patch (grep count 0).
- Patch content matches the worktree state hunk-for-hunk.

## 3. Reproduction — PASS (both runs)

In the worktree:

- `npm run test:run` run 1: **216/216 passed** (20 files, 860ms).
- `npm run test:run` run 2 (stability): **216/216 passed** (742ms). No flakes.
- `npm run build`: tsc + Vite production build succeeded.
- Baseline was 205; +11 new tests (8 in nightPipelineExceptionSafety.test.ts,
  3 in geminiAdapter.test.ts) accounts exactly for 216.

## 4. Wedge-proof audit (src/hooks/useGameState.ts)

Flag inventory: `grep -n setIsProcessingAI` shows the setter is now ONLY
(a) declared at line 101 and (b) passed by reference into the five
`runAIPhaseSafely` call sites (lines 385, 401, 416, 536, 557). No raw
`setIsProcessingAI(true)` remains anywhere. `runAIPhaseSafely` (lines 62–74)
raises the flag synchronously before the first await, catches the task error
into `onError`, and resets the flag in `finally`. It never rejects.

Per-handler trace (driver at line 185: `if (winner || !players.length ||
isProcessingAI) return;` — a stuck-true flag is the wedge condition):

- **handleWerewolfPhase (372–397).** Pre-flag `generateWolfChat` await is now
  in its own try/catch (376–381) — this was a second, previously unfixed wedge
  vector (rejection before the flag → no state change → driver never re-fires
  for an all-AI wolf team); good catch by the coder. Human-wolf early return
  (383) unchanged. Error path: system log + same fallback kill target the
  success path uses (first living non-wolf) → flag reset → `setPhase(NIGHT_SEER)`
  at 396 runs on BOTH paths, exactly once. No stuck, no double-advance.
- **handleSeerPhase (399–412).** Human-seer return before the flag unchanged.
  Error: check skipped (log), flag reset, `setPhase(NIGHT_WITCH)` at 411 on
  both paths. `aiSeerLastCheck` stays stale on error — same semantics as a
  dead seer night; cosmetic only.
- **handleWitchPhase (414–439).** Error: no potion used, potion inventory
  unchanged, flag reset, `setPhase(DAY_ANNOUNCE)` at 438 on both paths.
  `wolfKillId` still resolves normally in DAY_ANNOUNCE.
- **handleDiscussion (516–554).** Speaker is popped from the queue and set as
  currentSpeaker BEFORE the wrapped block (525–526), so a failing speech
  consumes exactly one queue slot. Error: skip log; `setCurrentSpeaker(null)`
  at 553 runs on both paths → driver re-fires → next speaker. Dead-human and
  alive-human early returns (528–534) precede the flag, unchanged.
- **finishVote (556–643).** Per-AI-voter try/catch (575–579): a failed vote
  records `votesByVoter[voter.id] = null` — the voter appears in
  `createVoteRecords` as an abstain, NOT dropped; remaining voters keep
  looping. Outer `onError` (639–642): log + `setPhase(NIGHT_START)`. Every
  `setPhase` inside the task body (tie 597, idiot 606, GAME_OVER 613/632,
  human hunter 621, night 638) is immediately followed by `return` with no
  throwing code after it, so no execution path both advances inside the task
  AND triggers `onError` — no double-advance. GAME_OVER paths are additionally
  shielded by the driver's `winner` check. The six scattered
  `setIsProcessingAI(false)` calls were replaced by the single `finally`;
  flag reset and setPhase land in the same synchronous continuation (React 18
  batches them, as pre-patch, order-insensitive for the driver effect which
  only sees final state). Flag still raised synchronously — the driver
  double-fire guard that `deadPlayerVoteAutoresolve.test.ts` depends on is
  preserved and now explicitly tested ("sets the flag synchronously").

Success-path preservation: diffed hunk-by-hunk against pre-patch — every task
body is the old code verbatim with only the `setIsProcessingAI` lines removed;
all decision logic (kill fallback, witch RNG thresholds, tally, idiot/hunter/
winner branches) byte-identical.

## 5. aiOrchestrator (src/ai/aiOrchestrator.ts) — PASS

- Only dynamic imports of geminiAdapter remain (lines 52, 64) — no static
  import that would defeat lazy loading or crash the test mock.
- `generateSpeechWithLLM` returns `null` on import rejection; both call sites
  (line 135 dialogue, 243 wolf chat) branch on `llmResult?.zh` / `raw?.zh`,
  so null falls to the library/hardcoded layers.
- `generateActionWithLLM` returns `{ targetId: null }` on rejection; call site
  (line 200) branches on `llmResult.targetId && valid.includes(...)`, falling
  to the Layer-1 decision.
- Import-success behavior unchanged: geminiAdapter's exported functions never
  reject (postForText catches everything → ''), so the added try/catch and
  `return await` are inert on the success path.

## 6. geminiAdapter (src/ai/geminiAdapter.ts) — PASS

- `timeoutSignal()` (lines 29–32): guarded by
  `typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'`
  — environments lacking the static (or AbortSignal entirely) get
  `undefined`, i.e. previous no-signal behavior, no crash.
- A FRESH signal is created per `postForText` call, so the adapter fetch's
  timeout cannot pre-abort the proxy fallback fetch.
- Both fetches (provider-adapter line 58, genai-proxy line 67) go through
  `postForText`, so BOTH carry the 12s bound.
- Timeout abort lands in the existing catch → `''` — the ''-on-failure
  contract is intact (adapter → proxy → '' → speech library).

## 7. Tests — PASS

- `runAIPhaseSafely` suite: asserts the wrapper resolves (no unhandled
  rejection), flag transitions exactly `[true, false]`, error is reported,
  success path clean, flag raised synchronously, and a faithful
  handleSeerPhase simulation still advances to NIGHT_WITCH after a rejection.
- Orchestrator suite: `vi.mock('./ai/geminiAdapter', () => { throw ... })`
  makes every dynamic import reject (the real production trigger);
  KILL/VOTE produce valid fallback targets, dialogue produces non-empty
  fallback speech, wolf chat produces 1–3 lines from wolf speakers.
- Adapter suite (+3): every fetch carries an `AbortSignal` from
  `AbortSignal.timeout(12000)`; signal omitted when the static is unavailable;
  timeout rejection returns `''` after trying both endpoints.
- Two consecutive full runs, both 216/216 — stable.

## 8. Regression scan — PASS

- `shouldAutoResolveVote` (lines 47–49) untouched; dead-player auto-resolve
  suite among the 216 passing.
- Speech pipeline / vote summary / gameEngine suites all pass unchanged.
- Phase ordering, tally logic, and AI decision logic verified byte-identical
  in the diff (scope boundary respected).

## Defects

None blocking. Two accepted-risk observations, both already disclosed in the
coder report:

- `src/hooks/useGameState.ts:639` — an exception in the tally section after
  votes were partially recorded advances to NIGHT_START without a complete
  vote record (severity: low; deliberate "never wedge" default per the card;
  per-voter guard makes this path require a non-AI failure).
- `src/hooks/useGameState.ts:408` — on seer-phase error, `aiSeerLastCheck`
  retains the previous night's value (severity: cosmetic; identical to the
  pre-existing dead-seer semantics).

VERDICT: PASS
