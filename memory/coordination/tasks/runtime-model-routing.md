# Task: runtime-model-routing

## Status

Accepted

## Objective

Wire the frontend LLM layer to the unified provider adapter: requests go to `/.netlify/functions/provider-adapter` with a requested model/route, falling back to `/.netlify/functions/genai-proxy` and then the speech library — preserving exactly the current behavior whenever provider-adapter is unavailable, and staying no-network in local Vite dev.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `src/ai/geminiAdapter.ts` (current frontend adapter: genai-proxy call, `isLocalVite` guard, empty-string-on-failure contract)
- `src/ai/aiOrchestrator.ts` (read-only — the 3-layer fallback consumer: LLM → speech library → hardcoded)
- `netlify/functions/provider-adapter.js` (the endpoint being targeted — from card `provider-adapter-refactor`)
- `memory/coordination/tasks/provider-adapter-refactor.md` (response contract: `{text, model_used, cost_estimate, fallback_used}`)

## Context

- **Parallel wave: Wave 2**. Dependencies: `provider-adapter-refactor` (must be Accepted first — this card targets its endpoint and response contract). May run concurrently with `model-routing-cost-guard` and `provider-adapter-dry-run` ONLY if the coordinator confirms non-overlapping paths hold (they do: this card is frontend-only; those are server/script-only).
- **Contract to preserve**: `generateWithGemini` (and thus `generateSpeechWithLLM` / `generateActionWithLLM`) returns `''` / `null` on any failure so `aiOrchestrator` falls back to the speech library. Signatures used by `aiOrchestrator` must not change.
- **Routing**: try `/.netlify/functions/provider-adapter` first with a requested model/route; on non-OK, empty text, network error, or the endpoint not existing (404), fall back to `/.netlify/functions/genai-proxy` with the exact current request shape; on that failing too, return `''` (speech library takes over). When provider-adapter is unavailable the observable behavior must be byte-identical to today.
- **Structure choice**: either extend `geminiAdapter.ts` in place, or create `src/ai/llmClient.ts` that `geminiAdapter.ts` delegates to — pick whichever yields the smaller, clearer diff. Do not create both a new module AND heavy edits in the old one.
- **Local dev**: the `isLocalVite` guard stays — no network calls on Vite dev/preview ports.
- No keys in frontend, ever. The requested model/route is a plain string validated server-side by the provider-adapter whitelist.
- Architecture rule: LLM layer only shapes expression; legality stays in the engine.
- Scope boundary: frontend LLM client only. No changes to server functions, orchestrator logic, or game code.

## Allowed changes

- `src/ai/geminiAdapter.ts`
- `src/ai/llmClient.ts` — new, optional
- Test files for the above

## Do not change

- `src/ai/aiOrchestrator.ts`, `netlify/functions/**`, game engine, or UI files.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. LLM requests target provider-adapter first, then genai-proxy, then return `''` for the speech-library fallback — the chain is deterministic and covered by tests with mocked fetch.
2. When provider-adapter is unavailable (404/network error), behavior is identical to the current implementation (same genai-proxy request body, same outputs).
3. Local Vite dev makes zero network calls (existing guard preserved and tested).
4. Public functions consumed by `aiOrchestrator` keep their signatures and failure contract (`''`/`null`).
5. No API keys or provider URLs other than the two Netlify function paths appear in frontend code.
6. `npm run test:run` and `npm run build` pass with zero regressions (baseline 55/55).

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/runtime-model-routing.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
