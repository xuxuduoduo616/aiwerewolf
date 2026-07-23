# Task: p2-model-adapter

## Status

Superseded — covered by later accepted implementation; do not dispatch directly

## Objective

Build a server-side provider/model adapter with a whitelist, timeout, retry, cost ceiling, and deterministic fallback. Then design distinct multi-role AI behavior configs (cautious / balanced / aggressive) for seer, witch, hunter, villager. Zero paid API calls in this iteration.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `src/ai/aiOrchestrator.ts`
- `src/ai/geminiAdapter.ts`
- `netlify/functions/genai-proxy.js`

## Context

- **Architecture boundary**: `gameEngine`, `beliefTracker`, `actionSelector` continue to own rules, phase state, and final actions. The adapter/LLM layer only enhances speech quality and role-flavored reasoning — it NEVER generates or executes illegal game actions.
- **Runtime AI config file**: `src/services/aiStyles.ts` — each AI player has a `styleKey` from `CUSTOM_AI_STYLES`.
- **Current proxy**: `netlify/functions/genai-proxy.js` — a thin Netlify function that forwards to Gemini. This is the server proxy to extend.
- **Legacy**: `src/services/aiPlayer.ts` is unused dead code. Do not use it as a base.
- **Zero paid calls constraint**: This iteration must use mocks, free-tier endpoints, or purely structural/config work. No real paid API calls.
- Scope boundary: Do not touch game engine, board configs, or frontend phase logic.
- Dependencies: none.
- Parallel wave: May run with `p1-vote-summary-redesign` (non-overlapping paths).

## Sub-tasks

### A. Multi-role behavior config

Design distinct behavior profiles for each playable role:
- `SEER`: cautious / balanced / aggressive check strategy
- `WITCH`: cautious / balanced / aggressive potion use
- `HUNTER`: cautious / balanced / aggressive shot strategy
- `VILLAGER`: cautious / balanced / aggressive accusation style
- `WEREWOLF`: (already has some in `aiStyles.ts` — extend or keep)

Each profile must have:
- Different prompt/instruction emphasis (not just a renamed copy)
- Testable behavioral parameters (e.g., poison_save_threshold, accusation_confidence_required)
- A test that shows distinct behavior across profiles

File: `src/services/roleProfiles.ts`

### B. Model adapter

Create `netlify/functions/model-adapter.js` (or extend `genai-proxy.js`):
- Provider config: model whitelist with IDs, cost per 1k tokens, timeout, max retries
- Route selection: default to cheap model, upgrade only for complex speech generation
- Fallback chain: primary model → secondary → local speech library
- Cost guard: reject if estimated cost exceeds a per-call ceiling
- No API keys in source — all from `process.env`

File: `netlify/functions/model-adapter.js`

### C. Offline benchmark schema

Create `src/ai/benchmark.ts`:
- Interfaces for: role consistency score, illegal action rate, vote rationality score, speech repetition rate, estimated cost per game
- A mock game result fixture that populates these fields
- Tests that validate the schema and mock fixture

File: `src/ai/benchmark.ts`

## Allowed changes

- `src/services/roleProfiles.ts` — new
- `netlify/functions/model-adapter.js` — new
- `src/ai/benchmark.ts` — new
- Test files for above

## Do not change

- `src/ai/aiOrchestrator.ts`, `src/ai/actionSelector.ts`, `src/ai/beliefTracker.ts`
- `src/services/aiPlayer.ts` (dead code, leave as-is)
- Game engine, board configs, or phase logic
- Existing `netlify/functions/genai-proxy.js` if model-adapter.js is a new file
- Git branches, commits, worktree configuration.

## Acceptance criteria

1. `roleProfiles.ts` exports at least 3 distinct behavior configs per role.
2. Two configs for the same role differ in at least 2 measurable parameters.
3. `model-adapter.js` has a model whitelist, fallback chain, and cost guard — no API keys hardcoded.
4. `benchmark.ts` exports typed interfaces and a mock fixture.
5. All tests pass, build clean.

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/p2-model-adapter.md`
- Verdict: PASS or FAIL.
