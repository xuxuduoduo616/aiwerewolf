# Debugger Review: provider-adapter-refactor

**Date:** 2026-07-16
**Reviewer:** Debugger (independent verification; no product code edited)
**Worktree:** `/Users/frank/aiwerewolf/.claude/worktrees/agent-ae5b6d742899c115a` (HEAD `b7a8529`)
**Patch:** `memory/coordination/runs/provider-adapter-refactor-claude.patch`

## Scope check — PASS

- `git status --short`: only `netlify/__tests__/provider-adapter.test.js` and
  `netlify/functions/provider-adapter.js` staged (both new). Untracked items are
  the worker's own report and a `node_modules` symlink — not part of the diff.
- `git diff HEAD --stat`: 2 files, 819 insertions, 0 deletions. Additive-only.
- `genai-proxy.js` and `model-adapter.js`: UNTOUCHED (no modification in status
  or diff).
- Patch file verified byte-equivalent to the staged diff (only `index` lines
  differ, as expected from regeneration).

## Reproduction — PASS

Run independently in the worktree:

- `npm run test:run` → **9 files, 62/62 passed** (47 pre-existing at HEAD
  `b7a8529` + 15 new provider-adapter tests). Zero failures.
- `npm run build` → succeeded (`tsc` + Vite, built in ~915 ms).

Baseline note for the coordinator: the card's "baseline 55/55" matches neither
the worktree HEAD (47 pre-existing tests) nor the current main repo working
tree (318/318 passing, which includes uncommitted test files from other
in-progress waves). The substantive requirement — zero regressions — holds:
every pre-existing test at the worktree HEAD passes and the patch is
additive-only. The card's numeric baseline is stale, not a coder defect.

## Per-criterion compliance

1. **Handler + test hooks** — PASS. Exports `handler`, `PROVIDER_REGISTRY`,
   `DEFAULT_CHAIN`, `COST_CEILING_PER_CALL`, breaker constants,
   `classifyError`, `redactForLog`, `recordProviderFailure/Success`,
   `isProviderOpen`, `resetProviderState` (provider-adapter.js:452-463).
2. **Registry** — PASS. Gemini (SDK), aicodemirror anthropic-messages
   (`x-api-key`, `AICODEMIRROR_API_KEY`), deepseek anthropic-messages
   (`x-api-key`, `DEEPSEEK_API_KEY`), plus a deepseek openai-chat route
   (Bearer) and local-fallback. Every entry has protocol, authHeader,
   apiKeyEnv, timeout, maxRetries, costPer1kTokens, capabilities. No vibecoder
   (test asserts absence, test.js:137). `apiKeyEnv` is an ordered array so
   Gemini honors `API_KEY` then `GEMINI_API_KEY` — a documented, tested
   extension of "apiKeyEnv name"; matches existing key-resolution behavior in
   model-adapter.js.
3. **Protocol translation** — PASS. anthropic-messages: POST
   `{baseUrl}/v1/messages` with `anthropic-version`, body
   `{model, max_tokens, temperature, messages:[{role:'user',content}]}`, text
   from `content[0].text` (js:264-285); test asserts exact URL, headers, and
   body (test.js:196-217). openai-chat: `{baseUrl}/chat/completions`,
   `choices[0].message.content` (js:288-308; test.js:219-234). Gemini via
   `@google/genai` with the same call shape as model-adapter.js (js:237-261).
   The handler API takes only `prompt` (same surface as model-adapter.js), so
   there is no system-prompt input to map to Anthropic's top-level `system`
   field — nothing is misplaced into `messages`.
4. **Error classification + breaker** — PASS. auth (401/403/missing-api-key),
   rate-limit (429), server (>=5xx), timeout (incl. AbortError→'timeout'
   mapping at js:223), network (default) — all five tested (test.js:236-246).
   Breaker: per-provider Map keyed by registry name (no cross-provider
   leakage), opens at 3 consecutive failures, 60 s cooldown, closes after
   cooldown (`openUntil > now`), success fully resets; half-open behavior
   (one post-cooldown failure re-opens) is correct and tested
   (test.js:248-272); handler-level skip tested (test.js:274-290). Map growth
   is bounded by registry key count. No never-resets bug.
5. **Cost guard + dry-run** — PASS. Same ~4 chars/token heuristic and $0.005
   ceiling as model-adapter.js; 402 on breach with no network (test.js:156-166).
   `ADAPTER_DRY_RUN=true` returns a deterministic mock before any provider
   call; test asserts neither fetch nor the SDK constructor fired
   (test.js:168-180).
6. **Fallback chain** — PASS. Deterministic order, requested provider promoted
   to front, ends in `{text:'', model_used:'local-fallback', cost_estimate:0,
   fallback_used:true}` with status 200 — never a thrown error to the client
   (all provider failures are caught in tryProviderWithRetries, js:323-338;
   res.json() parse failures propagate into that same catch). The full-chain
   test asserts the exact attempted-URL sequence including retry counts
   (test.js:305-329).
7. **Redaction proof** — PASS. Fake keys planted in env, errors deliberately
   embed them, every captured log line asserted clean and `[REDACTED]` present
   (test.js:331-345); direct redactForLog unit test (test.js:347-353).
8. **No keys / network-free tests** — PASS. Grep of the entire patch for
   key-like material (sk-, AIza, Bearer tokens, inline api_key values): none.
   Keys resolved only via `process.env` (js:201-207). The only console call in
   the module is inside `logError`, which redacts first (js:145-147). Client
   error responses are generic; no internal detail leakage. Tests use the
   vm-sandbox pattern from model-adapter.test.js with mocked fetch + SDK;
   default fetch mock rejects, so any unexpected network path fails the test.
9. **Test/build** — PASS (see Reproduction). CORS handling is line-identical
   to model-adapter.js (getAllowedOrigin + OPTIONS 204 + same header set).

## Test quality

Real assertions, not smoke: exact request URLs/headers/bodies, exact fallback
attempt sequences with retry counts, breaker state transitions with explicit
clocks, log-line content checks, and negative assertions (no fetch / no SDK
construction on guard paths).

## Defects

No high- or medium-severity defects found. Low-severity observations
(no repair required):

- L1 (low) provider-adapter.js:326-336 — retries have no backoff, and
  rate-limit/server errors retry immediately. Identical to the existing
  model-adapter.js pattern; auth errors correctly break the loop.
- L2 (low) provider-adapter.js:245-257 — Gemini timeout via Promise.race
  leaves the SDK request dangling after timeout (timer itself is cleared in
  `finally`). Same accepted pattern as model-adapter.js; the fetch protocols
  use AbortController, which is strictly better.
- L3 (low) provider-adapter.js:40 — aicodemirror model id `claude-sonnet-4-6`
  is an unverified assumption (discovery could not enumerate models without a
  key). Coder disclosed it; one-line registry fix if wrong. Owner should
  confirm before live use.
- L4 (info) — breaker state is per warm Lambda instance; documented in-source
  as a best-effort latency guard, per the card's explicit allowance.
- L5 (info, coordinator action) — `.gitignore` line 25 (`**/*.test.js`) means
  integration requires `git add -f netlify/__tests__/provider-adapter.test.js`,
  same as the existing model-adapter.test.js.

## Conclusion

Scope clean, verification reproduced independently (62/62 tests, build OK),
all nine acceptance criteria met, no key material anywhere in the diff, and
the security/redaction requirements are proven by tests rather than asserted.

VERDICT: PASS
