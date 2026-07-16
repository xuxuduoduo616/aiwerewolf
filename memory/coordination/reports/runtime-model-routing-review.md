# Review: runtime-model-routing

**Role:** Debugger (independent verification, no product code edited)
**Date:** 2026-07-16
**Worktree:** `/Users/frank/aiwerewolf/.claude/worktrees/agent-abf597da8cbe708a4` (HEAD `b7a8529`)
**Patch:** `memory/coordination/runs/runtime-model-routing-claude.patch`

## Scope check

`git status --short` in worktree:

```
A  src/ai/geminiAdapter.test.ts
M  src/ai/geminiAdapter.ts
?? memory/coordination/reports/runtime-model-routing.md   (worker report — allowed)
?? node_modules                                            (untracked symlink, not in patch)
```

Patch contents: exactly `src/ai/geminiAdapter.ts` (M) + `src/ai/geminiAdapter.test.ts` (A).
Both within the allowed list. `src/ai/llmClient.ts` intentionally not created
(card allows either shape). No changes to `aiOrchestrator.ts`, `netlify/functions/**`,
engine, or UI. Scope: CLEAN.

## Contract alignment (CRITICAL check vs CURRENT main `netlify/functions/provider-adapter.js`)

The worktree forked from `b7a8529`, which predates the unified adapter. I verified the
frontend against the adapter file as it exists on main today, field by field.

### Request — frontend sends → handler parses

| Frontend field (geminiAdapter.ts:48-53) | Handler side (provider-adapter.js) | Match |
| --- | --- | --- |
| `provider: 'gemini-2.5-flash'` | `body.provider` (line 370), validated against `PROVIDER_REGISTRY` — `'gemini-2.5-flash'` IS a registry key (line 23) | YES |
| `prompt` (string, `system\n\n---\nuser`) | `body.prompt`, required string (line 364-367); truncated server-side at 8000 chars | YES |
| `responseMimeType: 'application/json'` | `body.responseMimeType === 'application/json'` honored (line 398) | YES |
| `temperature` (number, `req.temperature ?? 0.95`) | `body.temperature` if number, clamped 0-2 (line 399) | YES |
| Method POST, `Content-Type: application/json` | handler requires POST (405 otherwise), `JSON.parse(event.body)` | YES |

### Response — handler returns → frontend reads

The frontend reads only `json.text` (with `typeof === 'string'` guard). Handler always
returns a string `text` on every 200 path:

- live-provider success: `{text, model_used, cost_estimate, fallback_used}` → frontend returns `text`. Correct.
- dry-run: `{text: '[dry-run] mock response', ...}` → returned. Correct.
- all-providers-failed local-fallback signal: 200 + `{text: '', model_used: 'local-fallback', cost_estimate: 0, fallback_used: true}` → `postForText` returns `''` (empty) → frontend falls back to genai-proxy, then speech library. Matches the card ("on ... empty text ... fall back").
- Error statuses 400 (invalid JSON / missing prompt / bad provider), 402 (cost guard, body `{error, cost_estimate}` with no `text`), 405: all non-OK → `postForText` returns `''` → fallback. Correct; no field-shape dependency on error bodies.
- `model_used` / `cost_estimate` / `fallback_used` are ignored by the frontend — safe, no coupling.

No mismatches found.

### Patch applies to CURRENT main

```
cd /Users/frank/aiwerewolf && git apply --check memory/coordination/runs/runtime-model-routing-claude.patch
→ PATCH_CHECK_OK (exit 0)
```

Main HEAD at review time: `42806e6`. Not applied — check only.

## Reproduction (in worktree)

- `npm run test:run` → **9 files, 65/65 passed** (worktree baseline 47 across 8 files + 18 new in `geminiAdapter.test.ts`). Zero regressions.
- `npm run build` → **success** (tsc + vite, built in ~0.9s).

Note: the card's "baseline 55/55" and the coder-reported dispatch figure of 130 both
differ from the actual worktree-HEAD baseline of 47; the coder measured and disclosed
this. Main is currently 158/158 per PROJECT_STATE; final integrated verification
remains the coordinator's step after applying the patch.

## Behavior preservation (diff vs original `b7a8529` geminiAdapter.ts)

- Public exports unchanged: `SpeechRequest`, `generateWithGemini(req: SpeechRequest): Promise<string>`, `generateSpeechWithLLM(...): Promise<{zh,en}|null>`, `generateActionWithLLM(...): Promise<{targetId: number|null; reason?}>` — identical signatures; `extractJson` and both consumers byte-untouched.
- `isLocalVite` guard preserved verbatim (same 4-port set, same `window` check), still the first statement in `generateWithGemini`.
- genai-proxy fallback body identical to the original: `{model: 'gemini-2.5-flash', prompt: systemPrompt + '\n\n---\n' + userPrompt, responseMimeType: 'application/json', temperature: req.temperature ?? 0.95}` — same fields, same values, same defaults.
- Fallback order provider-adapter → genai-proxy → `''`; `postForText` catches everything (non-OK, network error, invalid JSON, missing text) — no exception can reach callers.
- No keys; only the two Netlify function paths appear as URLs.

## Acceptance criteria

1. Deterministic chain provider-adapter → genai-proxy → `''`, covered by mocked-fetch tests — PASS.
2. provider-adapter unavailable (404/network error) ⇒ identical genai-proxy body asserted via deep-equal in tests; matches original source — PASS.
3. Vite guard: parameterized test over all 4 dev ports asserts `fetch` never called; non-dev port control test included — PASS.
4. Signatures and `''`/`null` failure contracts unchanged; direct tests on both consumer functions incl. invalid-target rejection — PASS.
5. No API keys / no third-party URLs in frontend code — PASS.
6. `npm run test:run` 65/65 and `npm run build` pass in the worktree; card's "55/55" figure did not match the actual fork-point baseline (47), disclosed by the coder; zero regressions against the real baseline — PASS with note.

## Required test coverage

Routing success, adapter 404 → proxy fallback, adapter network error → fallback,
adapter empty-text local-fallback signal → fallback, both-fail (500 / throw / missing
text) → `''`, custom temperature forwarding, 4-port no-network guard + non-dev control,
consumer success/failure contracts. All present and passing.

## Defects

None found.

Minor observations (non-blocking):
- Empty-text local-fallback from the adapter triggers a genai-proxy retry that is
  usually futile (the adapter already tried Gemini server-side), but the card
  explicitly requires falling back on empty text, so this is per spec and harmless.
- Coordinator should run the combined suite on main after applying the patch
  (expected 158 + 18 = 176), as usual for integration.

VERDICT: PASS
