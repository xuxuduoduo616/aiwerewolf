# Report: ai-role-evaluation

**Status:** Ready for review
**Worker:** Claude coder (isolated worktree `.claude/worktrees/agent-a996cd88041171700`)
**Patch:** `memory/coordination/runs/ai-role-evaluation-claude.patch`

## Summary

Offline evaluation harness implemented: deterministic mock provider + local
replay runner that plays scripted turns through the REAL `BeliefTracker` /
`selectAction` (imported read-only) under a given `BehaviorVariant`, producing
a typed `RoleEvaluationReport` with all four metrics. Zero network, zero
timers, no wall-clock dependence.

## Changed files

- `src/ai/evaluation.ts` — new. Mock provider, cost estimator, info-leakage
  detector, scripted-turn types, replay runner, report type.
- `src/ai/evaluation.test.ts` — new, 19 tests (force-added with `git add -f`;
  repo `.gitignore` excludes `**/*.test.ts` from deployment but existing test
  files are tracked the same way).
- `src/ai/benchmark.ts` — additive only: optional `infoLeakageRate?: number`
  field on `GameBenchmarkResult` (0–1, lower better) plus range validation in
  `isValidBenchmarkResult` that only runs when the field is present. No
  existing export, type, fixture, or semantic altered.
- `src/ai/benchmark.test.ts` — additive describe block, 3 new tests for the
  optional field (back-compat, in-range, out-of-range/NaN). Existing 5 tests
  unmodified.

## Replay design

- `ScriptedTurn` is a discriminated union: `speech` turns (round, actorId,
  scripted text) and `action` turns (round, actorId, `ActionType`, proposed
  target or `null` = pass).
- `runReplay(input)`:
  - Fresh local `new BeliefTracker()` initialized per run — never the global
    singleton, so runs are isolated and repeatable.
  - Speech turns: prompt built from the actor's `RoleBehaviorProfile`
    (`getRoleBehaviorProfile(role, variant)` — the variant visibly threads
    into prompts); mock provider echoes scripted speech and records the call;
    leakage + repetition measured; speech fed to `tracker.updateFromSpeech`.
  - Action turns: proposed target checked against a validity filter mirroring
    `generateAIAction` in `aiOrchestrator.ts` (alive, not self, KILL excludes
    wolves); real `selectAction` runs every action turn with
    `actionAccuracy = 1` (disables the difficulty randomizer — all remaining
    selector paths are deterministic once beliefs are initialized); accepted
    target = valid proposal, else the selector decision (mirrors the live
    LLM→L1 fallback). VOTE results update the tracker and accumulate real
    `VoteRecord`s fed back into later `selectAction` calls.
- Provider abstraction: `complete(prompt, scriptedResponse)`; the mock echoes
  the scripted response and records `{prompt, response}` for cost accounting.
  Custom deterministic providers can be injected.

## Metric definitions

| Metric | Definition |
| --- | --- |
| `illegalActionRate` | non-null proposed actions rejected by the validity filter ÷ action turns |
| `infoLeakageRate` | speeches matching ≥1 leakage rule ÷ speech turns |
| `speechRepetitionRate` | speeches whose whitespace-normalized text already appeared in an earlier turn ÷ speech turns |
| `estimatedCostUSD` | Σ ceil(chars/4) over all provider calls (prompt+response) ÷ 1000 × `costPer1kTokens` (default 0 for mock; estimator always exercised) |

Token heuristic matches `netlify/functions/model-adapter.js` (~4 chars/token).
Rates use `max(1, n)` divisors so empty fixtures yield 0, not NaN.

Leakage rules (exported `LEAKAGE_RULES`, keyword/regex per card):
`wolf-self-reveal` (我是狼…), `wolf-teammate-reveal` (队友/我们狼),
`non-seer-check-claim` (我是预言家 / 验了N号 / 我的金水|查杀 — true seer exempt),
`witch-potion-reveal` (解药/毒药/我救了/我毒了 — witch only).

## Verification

- `npm run test:run` — **69/69 passed, 9 files** (worktree baseline before
  change: 47/47, 8 files; +19 evaluation tests, +3 benchmark tests; all
  pre-existing tests pass unmodified).
- `npm run build` — succeeded (same pre-existing non-blocking Gemini
  double-import warning only).
- Determinism covered by an explicit repeated-run deep-equality test.
- Zero network: `evaluation.ts` imports only `types`, `beliefTracker`,
  `actionSelector`, `roleProfiles` — no fetch, no geminiAdapter, no timers,
  no `Date.now`. `Math.random()` inside `selectAction` is called but its
  result is discarded at accuracy 1.

## Decisions

- Card says baseline 55/55; this worktree's HEAD baseline is 47/47 (verified
  before changes). No pre-existing test was touched except additive appends.
- Validity filter is an observer copy of the orchestrator's filter (the card
  forbids touching the engine to expose it; function is commented with its
  origin).
- `benchmark.ts` extension kept minimal: optional field + guarded validation;
  `MOCK_BENCHMARK_RESULT` intentionally untouched (card: do not alter existing
  fixtures) — back-compat is tested via its absence of the field.
- No converter from `RoleEvaluationReport` to `GameBenchmarkResult`: the
  runner does not compute `roleConsistencyScore`/`voteRationalityScore`, so a
  converter would have to invent values. Shared fields reuse names/semantics.

## Limitations / residual risks

- Player liveness is static per fixture (no mid-replay death turns); deaths
  can be modeled by starting a fixture with `isAlive: false` players.
- Leakage detector is intentionally simple keyword/regex — e.g. `队友` in a
  wolf's speech is always flagged even in hypothetical phrasing; wolves
  bluffing seer (悍跳) are flagged as `non-seer-check-claim` per the card's
  explicit example.
- Validity-filter copy must be kept in sync if `generateAIAction`'s filter
  ever changes.

## Recommendation

Accept. Additive-only, isolated to `src/ai/` evaluation surface, deterministic
and offline; no engine, UI, or config touched.
