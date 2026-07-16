# Task: provider-adapter-refactor

## Status

Accepted

## Objective

Create `netlify/functions/provider-adapter.js` — a protocol-aware unified server-side adapter supporting Gemini, Anthropic-Messages, and OpenAI-Chat protocol providers, with circuit breaker, error classification, cost guard, dry-run mode, log redaction, and a deterministic fallback chain — fully tested with zero live network calls in tests.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`
- `netlify/functions/model-adapter.js` (pattern to extend from — do NOT modify it)
- `netlify/functions/genai-proxy.js` (production proxy — do NOT modify it)
- `netlify/__tests__/model-adapter.test.js` (the vm-sandbox mock test pattern to follow)
- `memory/coordination/reports/provider-discovery-initial.md` (verified provider protocols)

## Context

- **Parallel wave: Wave 1** (may run concurrently with `language-switch-and-ai-translation`, `role-behavior-distillation`, `ai-role-evaluation` — non-overlapping paths).
- Dependencies: `none`.
- This is a NEW file. `genai-proxy.js` (in production use) and `model-adapter.js` (Gemini-only registry) must NOT be modified. Reuse their conventions: CORS handling, cost guard shape, `ADAPTER_DRY_RUN`, response body shape `{text, model_used, cost_estimate, fallback_used}`.
- Verified provider facts (from `provider-discovery-initial.md` — trust these, do not re-probe):
  - aicodemirror `/api/claudecode` speaks Anthropic Messages protocol; accepts `x-api-key` OR `Authorization: Bearer`; returns proxy-wrapped errors `{"error": "string"}`, not Anthropic's error shape.
  - deepseek `https://api.deepseek.com/anthropic` is Anthropic-compatible; `x-api-key` auth; 401 without key.
  - vibecoder.store is UNREACHABLE from this network (TLS handshake fails) — do NOT include it in the registry.
- **PROVIDER_REGISTRY** entries carry: `{baseUrl, protocol: 'gemini' | 'anthropic-messages' | 'openai-chat', authHeader style, apiKeyEnv name, timeout, maxRetries, costPer1kTokens, capabilities}`.
- **Protocol translators**: Gemini via the existing `@google/genai` SDK (same as model-adapter.js); `anthropic-messages` and `openai-chat` via `fetch` with correct request-body shape and response-text extraction (Anthropic: `content[0].text`; OpenAI: `choices[0].message.content`).
- **Error classification**: classify each failure as `auth | timeout | rate-limit | server | network`.
- **Circuit breaker**: after N consecutive failures for a provider, skip that provider for a cooldown window (module-level state is acceptable per warm Lambda instance; document this limitation in a comment).
- **Cost guard**: token estimation (~4 chars/token, same heuristic as model-adapter.js) and per-call cost ceiling.
- **Fallback chain**: deterministic, ends in the local-fallback signal (`{text: '', model_used: 'local-fallback', fallback_used: true}`) so the frontend uses its speech library.
- **Keys**: `process.env` ONLY. Gemini uses existing `API_KEY` / `GEMINI_API_KEY`; anthropic-style providers use new env names (e.g. `AICODEMIRROR_API_KEY`, `DEEPSEEK_API_KEY`). Never hardcode keys; never put key values in this card, code, comments, or tests.
- **Log redaction**: no log line may ever contain key material or `Authorization`/`x-api-key` header values. Redact before logging.
- **CORS**: same `ALLOWED_ORIGIN` handling as the existing functions.
- Architecture rule: this layer only shapes expression; it never decides game actions. Rules stay in gameEngine/beliefTracker/actionSelector.
- Scope boundary: server function + its test file only. No frontend wiring (that is the `runtime-model-routing` card). No budget accumulator (that is `model-routing-cost-guard`).

## Allowed changes

- `netlify/functions/provider-adapter.js` — new
- `netlify/__tests__/provider-adapter.test.js` — new

## Do not change

- `netlify/functions/genai-proxy.js`, `netlify/functions/model-adapter.js`, or any frontend file.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. `provider-adapter.js` exports a Netlify handler plus test hooks (registry, cost constants, and any state-reset helper the circuit-breaker tests need).
2. PROVIDER_REGISTRY includes at least: a Gemini route, an aicodemirror anthropic-messages route, and a deepseek anthropic-messages route — each with protocol, authHeader style, apiKeyEnv, timeout, maxRetries, costPer1kTokens, capabilities. No vibecoder entry.
3. Protocol translation produces correct request-body shapes and extracts response text correctly for all three protocols (proven by tests with mocked fetch/SDK).
4. Errors are classified as auth/timeout/rate-limit/server/network; circuit breaker opens after N consecutive failures and skips the provider during cooldown, then recovers.
5. Cost guard rejects over-ceiling requests with 402; `ADAPTER_DRY_RUN=true` returns a deterministic mock with no network activity.
6. Fallback chain is deterministic and ends in the local-fallback signal (`text: ''`).
7. A redaction test proves no logged string ever contains a fake key planted in `process.env`.
8. No API key appears in source, tests, or logs. All tests are network-free (vm-sandbox mock pattern from `model-adapter.test.js`).
9. `npm run test:run` and `npm run build` pass with zero regressions (baseline 55/55).

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/provider-adapter-refactor.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
