# Report: runtime-model-routing

**Status:** Ready for review
**Worker:** Claude (coder)
**Worktree:** `/Users/frank/aiwerewolf/.claude/worktrees/agent-abf597da8cbe708a4`
**Patch:** `memory/coordination/runs/runtime-model-routing-claude.patch` (main repo)
**Note:** writing to the main-repo reports path was blocked by worktree isolation;
this report lives at the same relative path inside the worktree.

## Changed files

- `src/ai/geminiAdapter.ts` — modified (frontend LLM routing).
- `src/ai/geminiAdapter.test.ts` — new (18 tests; gitignored by `**/*.test.ts`, force-staged into the patch).

No other files touched. `src/ai/llmClient.ts` was NOT created — extending
`geminiAdapter.ts` in place produced the smaller, clearer diff (the shared
POST/parse logic became one `postForText` helper; the whole change is ~30 net
lines in one file).

## Routing design

`generateWithGemini` chain (deterministic):

1. `isLocalVite()` guard unchanged — Vite ports 5173/4173/4174/4175 return `''`
   with zero network calls.
2. POST `/.netlify/functions/provider-adapter` with
   `{ provider: 'gemini-2.5-flash', prompt, responseMimeType: 'application/json', temperature }`.
   The route is a plain string validated server-side against the adapter's
   whitelist (`PROVIDER_REGISTRY`). Non-empty `text` in the response is returned.
3. On non-OK status (incl. 404), network error, invalid JSON, missing `text`,
   or the empty-text local-fallback signal (`{text:'', model_used:'local-fallback'}`),
   fall back to POST `/.netlify/functions/genai-proxy` with the byte-identical
   legacy body: `{ model: 'gemini-2.5-flash', prompt: systemPrompt + '\n\n---\n' + userPrompt, responseMimeType: 'application/json', temperature: temp ?? 0.95 }`.
4. On that failing too, return `''` — callers (`generateSpeechWithLLM` →
   `null`, `generateActionWithLLM` → `{targetId: null}`) fall through to the
   speech library exactly as before.

Public exports unchanged: `SpeechRequest`, `generateWithGemini`,
`generateSpeechWithLLM`, `generateActionWithLLM` keep their exact signatures
and failure contracts. `src/ai/aiOrchestrator.ts` needed (and received) no
changes. No API keys and no URLs other than the two Netlify function paths in
frontend code.

## Fallback proof (tests, mocked fetch)

`src/ai/geminiAdapter.test.ts`, 18 tests:

- provider-adapter success → single call, correct URL/body, its text returned.
- provider-adapter 404 → genai-proxy called with the exact legacy body (asserted
  via deep-equal on the parsed body) → its text returned.
- provider-adapter network error → same genai-proxy fallback.
- provider-adapter 200 + empty-text local-fallback signal → genai-proxy fallback.
- both endpoints 500 / both throw / missing `text` field → `''`.
- custom temperature forwarded to both endpoints.
- Vite guard: each of the 4 dev ports → `''` and `fetch` never called; a
  non-dev port does call the network.
- Caller contract: `generateSpeechWithLLM` parsed-success and `null`-on-failure;
  `generateActionWithLLM` valid-target success, `null` on chain failure, and
  rejection of out-of-whitelist target ids.

## Verification

```
npm run test:run  →  9 files, 65/65 passed (worktree baseline 47 + 18 new)
npm run build     →  success (tsc + vite)
git status --short → only src/ai/geminiAdapter.ts (M) + geminiAdapter.test.ts (A); node_modules symlink left unstaged
```

## Limitations / notes for coordinator

- **Baseline mismatch:** the dispatch prompt said the worktree baseline is 130
  tests; this worktree HEAD (`b7a8529`) actually runs 47 tests / 8 files
  (verified before any change). Zero regressions against that real baseline.
- **provider-adapter.js is not in this worktree HEAD** — it exists only in the
  main repo working tree. I read the main-repo copy for the request/response
  contract (`provider` route field; `{text, model_used, cost_estimate,
  fallback_used}` response). The frontend only depends on `text` being a
  string, so it degrades cleanly regardless.
- **translationService.ts does not exist in this worktree HEAD** (it was named
  as read-only context). Nothing referencing any other endpoint was touched, so
  it cannot be broken by this patch.
- Empty-text from provider-adapter triggers the genai-proxy retry per the card
  ("on non-OK, empty text, network error … fall back"). If the adapter's whole
  server-side chain already failed, this second call is usually futile but
  harmless, and it preserves the deterministic chain the card requires.
- Runtime behavior against the deployed functions still needs the usual
  browser verification; all proof here is unit-level with mocked fetch.

**Recommendation:** accept; integrate after `provider-adapter-refactor` so the
endpoint exists in the integrated tree (the frontend is safe either way thanks
to the 404 fallback).
