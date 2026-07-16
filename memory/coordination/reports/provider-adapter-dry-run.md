# Worker Report: provider-adapter-dry-run

**Status:** Ready for review
**Date:** 2026-07-16
**Worktree:** `/Users/frank/aiwerewolf/.claude/worktrees/agent-adce7e1a797dc7251`
**Patch:** `memory/coordination/runs/provider-adapter-dry-run-claude.patch`

## Changed files (in patch)

- `scripts/provider-dry-run.mjs` — new verification script.
- `scripts/provider-dry-run.test.mjs` — unit tests for the pure report formatter and redaction (8 tests, no network, no filesystem).
- `memory/coordination/reports/provider-adapter-dry-run-results.md` — generated results report (default offline run).

No other files were modified. `netlify/functions/**` untouched.

## How the in-process dry-run works

- The script loads `netlify/functions/provider-adapter.js` in-process using the same `vm.Script` loader pattern as `netlify/__tests__/provider-adapter.test.js` (the repo is `"type": "module"`, so the CJS function file cannot be `import`ed directly).
- Inside the vm context, `fetch` and `require` are replaced with **guards** that record any access attempt and throw. Zero network in the default run is therefore proven, not assumed: the report records "Network/SDK access attempts during dry-run phase: 0".
- With `ADAPTER_DRY_RUN=true` (set by the script, previous value restored afterwards), `exports.handler` is invoked with a synthetic Netlify POST event per `PROVIDER_REGISTRY` entry (`{ prompt, provider }`).
- Contract verified per entry: `statusCode === 200`, non-empty `text` string, `model_used === <requested provider>`, `cost_estimate` is a non-negative number within `COST_CEILING_PER_CALL`, `fallback_used === false`, and optional budget fields (`budget_remaining`, `budget_used`) are numbers if present.
- Report formatting is a pure exported function `formatReport(results, meta) -> markdown` (date passed in via `meta`, no fs/date access inside), with a defensive `redactForReport` pass on every cell. The script exits non-zero on any contract failure or guard violation.

## Live-probe gating

- Runs ONLY when `LIVE_PROBE=true`. Default run makes zero network calls.
- Probes read-only models/listing endpoints only: `{baseUrl}/v1/models` (anthropic-messages), `{baseUrl}/models` (openai-chat). Completion/messages endpoints are never called anywhere in the script.
- `gemini` (SDK-managed, no REST base URL) and `local` entries are skipped with a reason. Missing env keys mark the entry `skipped (no key: <ENV_NAME> not set)` — never a failure; only the env-var NAME is shown, never a value.
- Redacted output: only provider name, model, HTTP status code, and error CLASS (`auth`/`rate-limit`/`server`/`timeout`/`network`) are printed. Auth header values and key material never reach stdout or the report; the formatter additionally strips `Bearer ...` and `authorization/x-api-key: ...` patterns (unit-tested).

## Verification results

Run in the worktree (dependency `provider-adapter-refactor` patch applied locally, see Decisions):

- `npm run test:run` — **70/70 passed (10 files)**. Worktree baseline before this card: 62 (47 at worktree HEAD `b7a8529` + 15 from the applied provider-adapter-refactor dependency). My 8 new formatter/redaction tests bring it to 70. Zero regressions.
- `npm run build` — TypeScript + Vite production build succeeded.
- `node scripts/provider-dry-run.mjs` — exit 0; all 5 registry entries PASS; 0 network/SDK access attempts; report written. Summary:
  - `gemini-2.5-flash` [gemini] PASS (cost_estimate=9e-7)
  - `aicodemirror-claude` [anthropic-messages] PASS (cost_estimate=0.000018)
  - `deepseek-anthropic` [anthropic-messages] PASS (cost_estimate=1.62e-6)
  - `deepseek-openai` [openai-chat] PASS (cost_estimate=1.62e-6)
  - `local-fallback` [local] PASS (cost_estimate=0)
- `LIVE_PROBE=true` with no provider keys in env — exit 0; every probe correctly `skipped` (SDK-managed / no key / local); dry-run results unchanged; still zero network. No live endpoint was actually hit during this task.

## Decisions

1. **Dependency handling:** `netlify/functions/provider-adapter.js` was NOT present at the worktree HEAD (`b7a8529`) — the accepted `provider-adapter-refactor` work exists only as uncommitted files in the main repo plus `runs/provider-adapter-refactor-claude.patch`. I applied that patch inside my worktree for verification only and **excluded it from my patch** (staged only my three allowed paths). Integration order: apply `provider-adapter-refactor-claude.patch` before this card's patch, or the script/tests will fail on the missing module.
2. **vm loader over `require`:** direct `require()`/`import` of the CJS function file fails under the package's `"type": "module"`; the vm pattern is the repo's existing convention (mirrors the adapter's own test) and enables the network guard.
3. **Gemini not probed live:** its endpoint is SDK-managed (`baseUrl: null`); probing the REST list-models API would require putting the key in a URL query string, which conflicts with the redaction requirement. Marked `skipped` with reason instead.
4. Test file named `.test.mjs` (picked up by vitest's default include; note `.gitignore` line 25 ignores `**/*.test.js`, so `.mjs` also keeps it trackable).
5. **Main-repo writes blocked by worktree isolation:** this report and the card status update are written at the same relative paths inside the worktree; the coordinator should copy/merge them. The patch file was written to main `runs/` successfully.

## Residual risks

- The dry-run proves the handler contract, not live provider behavior; live-probe with real keys has not been executed (no keys available). aicodemirror/deepseek auth remains unverified end-to-end.
- The results report's cost figures come from the registry's approximate per-1k-token constants; they are guard inputs, not billing truth.
- If a future card renames the models endpoints or adds a protocol, `MODELS_PATH_BY_PROTOCOL` in the script needs a matching entry (unknown protocols are skipped, not failed).

## Recommendation

Accept after integrating sequentially AFTER `provider-adapter-refactor` (this patch assumes that file exists). Re-run `npm run test:run`, `npm run build`, and `node scripts/provider-dry-run.mjs` post-integration; optionally run `LIVE_PROBE=true` once real provider keys are configured in the environment.
