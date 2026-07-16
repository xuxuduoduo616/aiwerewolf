# Task: ai-role-evaluation

## Status

Queued

## Objective

Build an offline evaluation harness (`src/ai/evaluation.ts`) with a deterministic mock provider and a local replay runner that plays scripted game turns through beliefTracker/actionSelector under a given behavior profile, computing illegal-action rate, info-leakage rate, repetition rate, and estimated cost per game — output as a typed report object, with fixture-based tests and zero network.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `src/ai/benchmark.ts` (existing schema — extend additively)
- `src/ai/benchmark.test.ts`
- `src/ai/beliefTracker.ts`, `src/ai/actionSelector.ts` (import READ-ONLY — understand their public APIs before designing the replay runner)
- `src/services/roleProfiles.ts` (behavior profiles the runner takes as input)

## Context

- **Parallel wave: Wave 1** (may run concurrently with `provider-adapter-refactor`, `language-switch-and-ai-translation`, `role-behavior-distillation` — non-overlapping paths).
- Dependencies: `none`. (If `role-behavior-distillation` lands first, its extended profiles remain backward-compatible — this card only consumes the existing `RoleBehaviorProfile` API.)
- **Mock provider**: deterministic, zero network. No fetch, no timers dependent on real time.
- **Replay runner**: plays N scripted game turns (fixtures) through the real `beliefTracker` / `actionSelector` with a given behavior profile. Import them read-only; do NOT modify or fork their logic. If an API is insufficient for a metric, compute the metric from observable outputs — do not change the engine.
- **Metrics**:
  - illegal-action rate: fraction of proposed actions rejected by the validity filter;
  - info-leakage rate: speech containing role knowledge the player should not reveal — simple regex/keyword detector (e.g. a non-seer stating check results, a wolf naming teammates);
  - repetition rate: duplicate speech across turns;
  - estimated cost per game (use the same ~4 chars/token heuristic as the server adapter; mock provider cost is 0 but the estimator must be exercised).
- **Output**: a typed report object. Where fields overlap `GameBenchmarkResult` in `benchmark.ts` (e.g. `illegalActionRate`, `speechRepetitionRate`, `estimatedCostUSD`), reuse those field names/semantics; extend `benchmark.ts` ADDITIVELY only (new exports allowed; do not alter or remove existing exports, types, or fixtures).
- Architecture rule: evaluation observes; it never mutates game rules or engine behavior.
- Scope boundary: offline analysis code + tests only. No UI, no server functions, no live LLM calls.

## Allowed changes

- `src/ai/evaluation.ts` — new
- `src/ai/benchmark.ts` — additive changes only
- Test files for the above (e.g. `src/ai/evaluation.test.ts`, additive cases in `src/ai/benchmark.test.ts`)

## Do not change

- `src/ai/beliefTracker.ts`, `src/ai/actionSelector.ts`, `src/gameEngine.ts`, `src/ai/aiOrchestrator.ts` — import read-only.
- Existing exports/semantics in `src/ai/benchmark.ts`.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. `evaluation.ts` exports a mock provider, a replay runner accepting scripted turns + a behavior profile, and a typed report object covering all four metrics.
2. The runner exercises the real beliefTracker/actionSelector (not reimplementations) and is fully deterministic — repeated runs on the same fixture yield identical reports.
3. Info-leakage detector flags at least the obvious cases in fixtures (non-seer check claims, wolf teammate reveals) and passes clean fixtures.
4. `benchmark.ts` changes are purely additive; all pre-existing tests pass unmodified.
5. Zero network activity in all code paths and tests.
6. `npm run test:run` and `npm run build` pass with zero regressions (baseline 55/55).

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/ai-role-evaluation.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
