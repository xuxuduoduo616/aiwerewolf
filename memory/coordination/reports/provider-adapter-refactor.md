# Report: provider-adapter-refactor

**Status:** Ready for review
**Date:** 2026-07-16
**Worker:** Claude coder (isolated worktree `/Users/frank/aiwerewolf/.claude/worktrees/agent-ae5b6d742899c115a`, HEAD `b7a8529`)
**Patch:** `memory/coordination/runs/provider-adapter-refactor-claude.patch`

## Objective recap

Create `netlify/functions/provider-adapter.js` — a protocol-aware unified
server-side adapter for Gemini, Anthropic-Messages, and OpenAI-Chat providers,
with circuit breaker, error classification, cost guard, dry-run mode, log
redaction, and a deterministic fallback chain ending in the local-fallback
signal. Fully tested with zero live network calls. `model-adapter.js` and
`genai-proxy.js` were not touched.

## Changed files

- `netlify/functions/provider-adapter.js` — new (465 lines)
- `netlify/__tests__/provider-adapter.test.js` — new (354 lines, 15 tests)

## Design decisions

### Registry shape

`PROVIDER_REGISTRY` keyed by route name, each entry:
`{baseUrl, protocol, model, authHeader, apiKeyEnv, timeout, maxRetries, costPer1kTokens, capabilities}`.

- `apiKeyEnv` is an **array** of env-var names resolved in order, so the Gemini
  route can honor both existing names (`API_KEY`, then `GEMINI_API_KEY`)
  without special-casing.
- Routes: `gemini-2.5-flash` (SDK), `aicodemirror-claude`
  (anthropic-messages, `x-api-key`, `AICODEMIRROR_API_KEY`),
  `deepseek-anthropic` (anthropic-messages, `x-api-key`, `DEEPSEEK_API_KEY`),
  `deepseek-openai` (openai-chat, Bearer, same `DEEPSEEK_API_KEY` — grounded in
  the discovery fact that DeepSeek `/v1` is OpenAI-compatible with Bearer auth;
  it also gives the openai-chat protocol a real registry consumer), and
  `local-fallback` (0 cost, never calls out). No vibecoder entry (unreachable
  per discovery report); a test asserts its absence.
- Assumption: aicodemirror model id `claude-sonnet-4-6` (discovery could not
  enumerate models without a key; taken from the environment's default model
  list). Trivial one-line registry fix if wrong.

### Protocols

- `gemini`: existing `@google/genai` SDK, same call shape as model-adapter.js,
  timeout via `Promise.race` (timer cleared in `finally` to avoid dangling
  handles).
- `anthropic-messages`: `fetch POST {baseUrl}/v1/messages` with
  `anthropic-version` header, body `{model, max_tokens, temperature, messages}`,
  text extracted from `content[0].text`.
- `openai-chat`: `fetch POST {baseUrl}/chat/completions`, body
  `{model, temperature, messages}`, text from `choices[0].message.content`.
- HTTP errors classified by status only, never by body shape (aicodemirror
  wraps errors in its own `{"error": "string"}` format).

### Error classification and circuit breaker

- `classifyError`: 401/403/`missing-api-key` → `auth`; 429 → `rate-limit`;
  ≥500 → `server`; `timeout` message (incl. AbortError mapping) → `timeout`;
  else `network`. Auth failures break the retry loop immediately (retrying is
  pointless).
- Breaker: 3 consecutive failures (one recorded per exhausted provider per
  request) opens the provider for 60 s; success resets; after cooldown the
  provider is attempted again and a further failure re-opens it. State is
  module-level per warm Lambda instance — documented in-source as a best-effort
  latency guard, not a correctness mechanism. `resetProviderState()` +
  `recordProviderFailure/Success` + `isProviderOpen(name, now)` exported for
  tests (explicit `now` parameter keeps breaker tests clock-independent).

### Cost guard, dry-run, fallback, redaction

- Same ~4 chars/token heuristic and $0.005 per-call ceiling as
  model-adapter.js; 402 on breach, evaluated against the primary route on the
  pre-truncation prompt.
- `ADAPTER_DRY_RUN=true` returns the deterministic mock with zero network
  activity (asserted against both fetch and the SDK constructor).
- Chain: requested provider (or default order) → remaining registry live
  routes in fixed order → `{text: '', model_used: 'local-fallback',
  cost_estimate: 0, fallback_used: true}`. Response body shape matches
  model-adapter (`{text, model_used, cost_estimate, fallback_used}`).
- Redaction: all module logging goes through `logError`, which strips every
  env value named by any registry `apiKeyEnv`, plus `Bearer <token>` and
  `authorization:`/`x-api-key:` header-value patterns, before `console.error`.

## Verification

Commands run in the worktree (node_modules symlinked from the main repo):

- `npm run test:run` → **9 files, 62/62 passed** (47 pre-existing at this
  worktree HEAD + 15 new provider-adapter tests). Note: the card's "baseline
  55" figure does not match this HEAD (`b7a8529`), which has 47 tests; all 47
  pre-existing tests still pass, zero regressions.
- `npm run build` → succeeded (`tsc` + Vite, built in ~1 s).
- `git status --short` after staging: only the two allowed paths.

New tests cover: registry shape/no-vibecoder, unknown provider 400, missing
prompt 400, cost-ceiling 402, dry-run with no network, all three protocol
request/response shapes, error classification (all five classes), breaker
open/cooldown/recovery (unit) and handler skip (integration), missing-key
auth without retries, deterministic full-chain fallback to the local signal
(exact attempted-URL sequence asserted), and a redaction proof that planted
fake env keys never appear in any captured log line.

## Known limitations

1. Breaker/registry state is per warm Lambda instance; cold starts reset it
   and concurrent instances do not share it (documented in-source).
2. aicodemirror model id is an unverified assumption (see above).
3. `anthropic-messages`/`openai-chat` routes ignore `responseMimeType`
   (JSON mode); capability metadata marks them `['text']` — callers wanting
   JSON should route to Gemini (frontend wiring is the `runtime-model-routing`
   card).
4. Integration note for the coordinator: `.gitignore` contains `**/*.test.js`,
   so committing the new test file after applying the patch requires
   `git add -f netlify/__tests__/provider-adapter.test.js` (same situation as
   the already-committed `model-adapter.test.js`).

## Recommendation

Accept. The patch is additive-only (two new files), passes full verification
with zero regressions, and stays inside the card's scope. Before live use,
confirm the aicodemirror model id and set `AICODEMIRROR_API_KEY` /
`DEEPSEEK_API_KEY` in Netlify env (owner action).
