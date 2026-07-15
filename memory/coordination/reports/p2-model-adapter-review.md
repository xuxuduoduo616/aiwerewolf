# Review: p2-model-adapter

**Reviewer:** Debugger
**Date:** 2026-07-15
**Result:** PASS

## Verification findings per criterion

### 1. roleProfiles.ts exports >=3 distinct configs (cautious/balanced/aggressive) per driven role
PASS. `ROLE_BEHAVIOR_PROFILES` is `Record<Role, Record<BehaviorVariant, RoleBehaviorProfile>>`. All 5 driven roles (SEER, WITCH, HUNTER, VILLAGER, WEREWOLF) plus IDIOT have all three variants. `Role` enum confirmed in `src/types.ts` (WEREWOLF, VILLAGER, SEER, WITCH, HUNTER, IDIOT). IDIOT is included as a neutral set only to keep the record exhaustive over the enum, which is a reasonable typing choice, not a spec violation.

### 2. cautious vs aggressive differ by >=0.2 in >=2 numeric params (each driven role)
PASS. Verified by reading values (params: accusationConfidence, poisonSaveThreshold, voteRationality, bluffProbability):
- SEER: accusation 0.8→0.45 (0.35), voteRationality 0.85→0.6 (0.25) — 2 params.
- WITCH: accusation 0.75→0.45 (0.30), poisonSaveThreshold 0.3→0.8 (0.50), voteRationality 0.85→0.6 (0.25) — 3 params.
- HUNTER: accusation 0.8→0.45 (0.35), voteRationality 0.85→0.6 (0.25) — 2 params.
- VILLAGER: accusation 0.8→0.45 (0.35), voteRationality 0.85→0.6 (0.25) — 2 params.
- WEREWOLF: accusation 0.8→0.45 (0.35), voteRationality 0.85→0.55 (0.30), bluffProbability 0.15→0.85 (0.70) — 3 params.
Test `roleProfiles.test.ts` independently asserts this contract for all DRIVEN_ROLES and that all three system prompt addenda are distinct.

### 3. model-adapter.js: whitelist + fallback chain (primary→secondary→local) + cost guard
PASS. `MODEL_REGISTRY` whitelist (gemini-2.5-flash, gemini-2.0-flash-exp, local-fallback). Fallback chain builds `[primary, SECONDARY_ROUTE]` then a `local-fallback` signal response when all live models fail. `COST_CEILING_PER_CALL = 0.005` cost guard rejects with 402.

### 4. No hardcoded API keys — all from process.env
PASS. Key read only inside `callModel` via `process.env.API_KEY || process.env.GEMINI_API_KEY`; throws `missing-api-key` if absent. No literals.

### 5. Unknown model → 400; over-cost → 402; ADAPTER_DRY_RUN=true → mock
PASS. Unknown named model → 400 `Model not in whitelist` before any client construction. Estimated cost over ceiling → 402 with `error` containing "ceiling". `ADAPTER_DRY_RUN === 'true'` → 200 deterministic `[dry-run] mock response`, no network. All three covered by passing tests.

### 6. benchmark.ts exports GameBenchmarkResult + MOCK_BENCHMARK_RESULT with valid ranges
PASS. `GameBenchmarkResult` interface, `isValidBenchmarkResult()` range/structural validator, and `MOCK_BENCHMARK_RESULT` fixture (all unit-interval fields within 0–1, cost 0.0034 >= 0). Tests validate the fixture and reject out-of-range / negative / empty-string mutations.

### 7. No modifications to forbidden files
PASS. mtimes: actionSelector.ts (Jul 4), beliefTracker.ts (Jul 4), aiOrchestrator.ts (Jul 13), aiPlayer.ts (Jul 7), gameEngine.ts (Jul 7) — all predate the new files (Jul 15). None touched. Only the three allowed new files + their tests were added.

## Security check (exact grep output)

Command:
```
grep -rniE "(sk-[a-z0-9]{20}|AIza[a-z0-9_-]{30}|api[_-]?key\s*[:=]\s*['\"][a-z0-9]{16})" netlify/functions/model-adapter.js src/services/roleProfiles.ts src/ai/benchmark.ts
```
Output: (no matches) — `EXIT_CODE=1`. No leaked secrets or real API keys.

## Flagged deviation review (cost guard on pre-truncation size)

Sound and an improvement. If cost were computed after truncating to MAX_PROMPT_LEN (8000 chars ≈ 2000 tokens), max cost for the default model is ~$0.0003 — always under the $0.005 ceiling, making the guard dead code. Estimating cost on the requested (pre-truncation) size makes the guard functional (oversized requests are rejected with 402), then truncation still runs as secondary safety before any live call. Required-case behavior is unchanged. Not a regression.

## Exact test output

```
 ✓ netlify/__tests__/genai-proxy.test.js (6 tests) 5ms
 ✓ src/guestLobbyTransition.test.ts (4 tests) 1ms
 ✓ src/components/PlayerCard.wolfvision.test.ts (10 tests) 2ms
 ✓ netlify/__tests__/model-adapter.test.js (5 tests) 4ms
 ✓ src/gameEngine.test.ts (11 tests) 2ms
 ✓ src/services/roleProfiles.test.ts (4 tests) 3ms
 ✓ src/services/supabaseClient.test.ts (2 tests) 35ms
 ✓ src/integration.test.ts (3 tests) 4ms
 ✓ src/components/VoteSummary.test.ts (5 tests) 5ms
 ✓ src/ai/benchmark.test.ts (5 tests) 1ms

 Test Files  10 passed (10)
      Tests  55 passed (55)
```
The earlier roleProfiles.test.ts syntax error is resolved (suite loads and passes).

## Exact build output

```
> tsc && vite build
vite v5.4.21 building for production...
✓ 1572 modules transformed.
✓ built in 954ms
```
Clean tsc + vite build.

VERDICT: PASS
