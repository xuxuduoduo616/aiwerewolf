# Review: ai-role-evaluation

**Debugger verdict review — independent verification**
**Worktree:** `.claude/worktrees/agent-a996cd88041171700` (base `b7a8529`)
**Patch:** `memory/coordination/runs/ai-role-evaluation-claude.patch`

## Scope check

`git status --short` in the worktree shows exactly four staged files, all allowed:

```
M  src/ai/benchmark.test.ts   (+19, appended describe block only)
M  src/ai/benchmark.ts        (+10, additive)
A  src/ai/evaluation.test.ts  (+238)
A  src/ai/evaluation.ts       (+318)
```

- `beliefTracker.ts`, `actionSelector.ts`, `gameEngine.ts`, `aiOrchestrator.ts`: untouched.
- `benchmark.ts` diff is purely additive: one new optional field `infoLeakageRate?: number` on `GameBenchmarkResult` plus a guarded range check in `isValidBenchmarkResult` that only runs when the field is present. No existing line removed or semantically altered; `MOCK_BENCHMARK_RESULT` and `RATE_FIELDS` unchanged.
- `benchmark.test.ts` diff appends a new describe block after the existing one; the original 5 tests are byte-for-byte unmodified and pass.
- Patch file matches the staged diff (identical file list and per-file line counts) and `git apply --check` passes cleanly against current main HEAD `d57e900`.
- Untracked `node_modules` / report file in the worktree are environment artifacts, not part of the patch.

## Reproduction results

- Run 1: `npm run test:run` — **69 passed / 69, 9 test files** (includes `evaluation.test.ts` 19, `benchmark.test.ts` 8 = 5 original + 3 additive).
- Run 2: `npm run test:run` — **69 passed / 69, 9 test files** — identical results, confirming stable/deterministic tests.
- `npm run build` — succeeded (only the pre-existing non-blocking Gemini double-import chunking behavior; no new warnings or errors).
- Baseline note: worktree HEAD `b7a8529` carries 47 pre-existing tests (69 − 22 new), matching the coder's documented baseline; the card's "55/55" refers to a different baseline commit. All pre-existing tests pass unmodified, so criterion 6 ("zero regressions") is satisfied relative to the worktree base, and the patch also applies cleanly to current main HEAD.

## Determinism audit

- No `fetch`, `XMLHttpRequest`, dynamic `import()`, `setTimeout`/`setInterval`, or `Date.now` anywhere in `evaluation.ts`, `evaluation.test.ts`, or the `benchmark.ts` diff (grep-verified). `roleProfiles.ts` (imported) is static data — also clean.
- `runReplay` uses a fresh local `new BeliefTracker()` (not `globalBeliefTracker`) and initializes it per run — runs are isolated.
- `selectAction` is called with `actionAccuracy = 1`: the difficulty gate `Math.random() > 1` is always false (one discarded `Math.random()` call, no effect on output). The remaining `Math.random` fallback branches in `actionSelector.ts` (lines 78, 96, 124) are unreachable once `tracker.init(players)` has run: `getMostSuspicious`/`getLeastVerified` return non-null whenever the candidate set is non-empty (deterministic `reduce`, first-in-array tie-break), and empty-candidate cases return early with `null` before those branches.
- An explicit repeated-run deep-equality test exists (`evaluation.test.ts:135`).

## Metric spot-checks

1. **Illegal-action rate — real.** `evaluation.ts:190` `validTargetsFor` is a faithful observer copy of the filter in `aiOrchestrator.ts:159-166` (alive, not self, KILL excludes wolves; the orchestrator's `VOTE → p.isAlive` clause is redundant with the alive check, so semantics match). Every action turn's proposed target is routed through it; rejections are recorded and divided by action turns. Tests exercise wolf-kills-teammate, nonexistent target, and dead-target rejection (2/3 and 1/1 rates asserted) — not a hardcoded fixture.
2. **Info-leakage — real and applied.** `detectInfoLeakage` runs on the provider-returned speech of every speech turn (`evaluation.ts:249`). Rules are role-conditional: wolf self-reveal (我(就|们)?是狼), wolf teammate reveal (队友|我们狼), non-seer check claim (我是预言家 / 验了N号 / 金水|查杀 — true seer exempt via `appliesTo`), witch potion reveal (解药|毒药|我救了/我毒了 — witch only, so a villager merely saying 毒药 is correctly not flagged). Verified against plausible speech in tests, including the clean-fixture pass and the seer-exemption case. Over-flagging of hypothetical 队友 phrasing is an acknowledged, acceptable limitation for a keyword detector per the card.
3. **Repetition rate — real.** Whitespace-normalized exact-match against a `Set` of prior speeches; duplicates counted across turns, divided by speech turns. Tested (1/3).
4. **Cost estimate — sane.** `ceil(chars/4)` matches the heuristic in `netlify/functions/model-adapter.js:27`; cost = Σ(prompt+response tokens)/1000 × `costPer1kTokens`. Mock default rate 0 yields $0 while still exercising the estimator; a nonzero-rate test asserts a positive cost consistent with `estimateEvalCostUSD`. Hand-check: 2 calls × 4-char strings → 2 tokens × 0.5/1k = 0.001, asserted.

## Real integration

`runReplay` imports and exercises the real `BeliefTracker` (`init`, `updateFromSpeech`, `updateFromVote`) and the real `selectAction` on every action turn; accumulated `VoteRecord`s feed later selector calls. The mock replaces only the LLM layer (`EvalProvider.complete`), mirroring the live LLM→L1 fallback: a valid proposed target wins, otherwise the selector's decision is used. Test assertions depend on real selector behavior (e.g. witch declines to poison at 0.5 < 0.7 suspicion; wolf fallback kill lands on the seer via belief priorities) — these would fail against stubs.

## Per-criterion compliance

| # | Criterion | Result |
| --- | --- | --- |
| 1 | Mock provider + replay runner (scripted turns + behavior profile) + typed report with all 4 metrics | PASS — `createMockProvider`, `runReplay(ReplayInput)`, `RoleEvaluationReport` |
| 2 | Real beliefTracker/actionSelector, fully deterministic | PASS — verified by code audit + double run + explicit test |
| 3 | Leakage detector flags obvious cases, passes clean fixtures | PASS — all four rule classes + clean/seer-exempt cases tested |
| 4 | benchmark.ts purely additive; pre-existing tests pass unmodified | PASS — diff-verified |
| 5 | Zero network | PASS — grep-verified across all touched files and their imports |
| 6 | test:run + build pass, zero regressions | PASS — 69/69 twice, build clean |

## Defects

None blocking. Non-blocking observations:

- `src/ai/evaluation.ts:190` — validity filter is a documented observer copy of `generateAIAction`'s filter; will drift if the orchestrator filter ever changes (already listed as residual risk in the coder report; card forbade engine changes, so this is the correct trade-off).
- Worktree base `b7a8529` predates current main HEAD `d57e900`; patch nevertheless applies cleanly to `d57e900`. Coordinator should still run combined verification after integration as usual.

VERDICT: PASS
