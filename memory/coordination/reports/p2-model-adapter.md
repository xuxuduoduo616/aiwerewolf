# Report: p2-model-adapter

## Verdict

PASS

## Summary

Delivered the three deliverables as new files only. No paid API calls, no hardcoded keys, and none of the forbidden files (`aiOrchestrator.ts`, `actionSelector.ts`, `beliefTracker.ts`, `aiPlayer.ts`, game engine, board configs) were touched. Nothing committed.

## Changes

- `src/services/roleProfiles.ts` (new) — `RoleBehaviorProfile` type + `BehaviorVariant` ('cautious' | 'balanced' | 'aggressive'). `ROLE_BEHAVIOR_PROFILES` covers every `Role` (SEER, WITCH, HUNTER, VILLAGER, WEREWOLF driven; IDIOT included as neutral to keep the map exhaustive over the `Role` enum and avoid a partial-record type). Numeric params: `accusationConfidence`, `poisonSaveThreshold`, `voteRationality`, `bluffProbability`. `bluffProbability` is only meaningful (>0) for WEREWOLF. Helper `getRoleBehaviorProfile(role, variant)`.
- `netlify/functions/model-adapter.js` (new) — `MODEL_REGISTRY` whitelist (gemini-2.5-flash, gemini-2.0-flash-exp, local-fallback), `COST_CEILING_PER_CALL = 0.005`. Handler: validates method/JSON/prompt, rejects unknown model (400), rejects over-ceiling cost (402), dry-run mock when `ADAPTER_DRY_RUN === 'true'`, else fallback chain primary -> secondary -> local-fallback signal, each with per-model timeout + retries. Returns `{ text, model_used, cost_estimate, fallback_used }`. All keys from `process.env`. Follows the existing `genai-proxy.js` CORS/rate-safety conventions.
- `src/ai/benchmark.ts` (new) — `GameBenchmarkResult` interface, `isValidBenchmarkResult()` range/structural validator, `MOCK_BENCHMARK_RESULT` fixture.
- `src/services/roleProfiles.test.ts`, `netlify/__tests__/model-adapter.test.js`, `src/ai/benchmark.test.ts` (new) — the model-adapter test reuses the vm-sandbox loader pattern from the existing `genai-proxy.test.js`.

## Design note (deviation from literal spec)

The task's guard ordering would truncate the prompt to 8000 chars *before* the cost check, which makes the cost guard unreachable for the default model (max ~2000 tokens ≈ $0.0003, well under the $0.005 ceiling — dead code). I moved the cost estimate to run on the *requested* (pre-truncation) prompt size so the guard is functional, then truncate afterward as a secondary safety before any live call. Behavior for the required test cases is unchanged: unknown model -> 400, over-ceiling -> 402, dry-run -> mock.

## Verification

- `npm run test:run` — 55 passed (10 files); new suites: roleProfiles 4, benchmark 5, model-adapter added.
- `npm run build` — clean (tsc + vite).

## Acceptance criteria

1. >=3 distinct configs per role — yes (3 variants each).
2. Same-role configs differ in >=2 measurable params — yes; test asserts cautious vs aggressive differ by >=0.2 in >=2 numeric params for all 5 driven roles.
3. Whitelist + fallback chain + cost guard, no hardcoded keys — yes.
4. Typed benchmark interfaces + mock fixture — yes.
5. Tests pass, build clean — yes.

## Risks / notes

- Cost figures in `MODEL_REGISTRY` are approximate heuristics for the local guard, not billing truth. Token estimate uses ~4 chars/token.
- Adapter is not yet wired into `geminiAdapter.ts`/orchestrator (out of scope; those files were off-limits). Integration is a follow-up.
