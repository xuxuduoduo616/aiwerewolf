# Task: role-behavior-distillation

## Status

Queued

## Objective

Add a structured behavioral-parameter schema (`src/ai/behaviorSchema.ts`) for distilled role behavior and extend `src/services/roleProfiles.ts` to conform to it, with every parameter labeled by data source (`aiwolf-distilled` / `synthetic` / `heuristic`) — no claims of training — plus tests proving schema validity and distinct variants.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `src/services/roleProfiles.ts` (existing profiles to extend — cautious/balanced/aggressive per role)
- `src/services/roleProfiles.test.ts` (existing distinctness test conventions)
- `memory/coordination/reports/p2-aiwolf-feasibility.md` (which roles the AIWolf corpus actually covers)
- `src/ai/actionSelector.ts` and `src/gameEngine.ts` (read-only — ground parameters in what these can actually consume)

## Context

- **Parallel wave: Wave 1** (may run concurrently with `provider-adapter-refactor`, `language-switch-and-ai-translation`, `ai-role-evaluation` — non-overlapping paths).
- Dependencies: `none`.
- **`src/ai/behaviorSchema.ts` (new)**: JSON-schema-like TypeScript types for per role × variant behavioral parameters, e.g. `{firstNightTargetPriority, claimTiming, voteFollowsSuspicion, saveThreshold, poisonThreshold, shootThreshold, speechAggressiveness, ...}`. Each parameter must be grounded in something gameEngine/actionSelector can actually consume — do NOT invent parameters no consumer could read. Include a runtime validator (plain TS function, matching the `isValidBenchmarkResult` style in `src/ai/benchmark.ts`).
- **Source labeling (mandatory)**: every parameter value carries a source tag: `'aiwolf-distilled' | 'synthetic' | 'heuristic'`. Document in code comments that the AIWolf corpus maps only Werewolf/Villager/Seer cleanly; Witch/Hunter/Idiot use synthetic templates (per the feasibility report). NO claims of "training" anywhere — this is distillation/heuristic parameterization only.
- **`roleProfiles.ts` (extend)**: keep the existing `RoleBehaviorProfile` exports and `getRoleBehaviorProfile` API backward-compatible (other code and tests depend on them). Extend, do not break. The existing invariant — cautious vs aggressive differ by >= 0.2 in at least two numeric params — must continue to hold and be tested for any new numeric parameters where meaningful.
- Architecture rule: profiles shape expression and thresholds ONLY; gameEngine/beliefTracker/actionSelector own legality and final actions. Nothing in this card executes actions.
- Scope boundary: types + data + tests. No consumer wiring, no engine changes, no LLM calls.

## Allowed changes

- `src/ai/behaviorSchema.ts` — new
- `src/services/roleProfiles.ts` — extend (backward-compatible)
- Test files for the above (e.g. `src/ai/behaviorSchema.test.ts`, extend `src/services/roleProfiles.test.ts`)

## Do not change

- `src/gameEngine.ts`, `src/ai/beliefTracker.ts`, `src/ai/actionSelector.ts`, `src/ai/aiOrchestrator.ts` (import read-only if needed).
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. `behaviorSchema.ts` exports typed parameter definitions plus a runtime validator; every parameter has a documented consumer rationale.
2. Every parameter value carries a source tag from `'aiwolf-distilled' | 'synthetic' | 'heuristic'`; Witch/Hunter/Idiot parameters are labeled synthetic/heuristic (never aiwolf-distilled).
3. No wording anywhere claims model training.
4. `roleProfiles.ts` existing exports and behavior remain backward-compatible; all pre-existing tests still pass unmodified in intent.
5. Tests prove: schema validity of all profiles, and distinct variants per role (cautious vs aggressive differ measurably).
6. `npm run test:run` and `npm run build` pass with zero regressions (baseline 55/55).

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/role-behavior-distillation.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
