# Task: netlify-functions-cjs-fix

## Status

Accepted

## Objective

Fix the production 502 load-time crash of all Netlify Functions by renaming the
three CommonJS function files from `.js` to `.cjs` so Node parses them as
CommonJS despite the root `package.json` `"type": "module"`.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`

## Context

- Production error (verified live 2026-07-17 on aiwerewolf.netlify.app):
  `ReferenceError: module is not defined in ES module scope` — deployed
  `/var/task/genai-proxy.js` sits next to the root `package.json` which has
  `"type": "module"`, so the CJS function files are parsed as ESM and crash at
  load. Both `genai-proxy` and `provider-adapter` return 502 on every request.
- Root `package.json` has had `"type": "module"` since the initial commit —
  every deploy of this repo has had broken functions. The frontend silently
  falls back (provider-adapter → genai-proxy → speech library), which masked it.
- Coordinator decision: use the `.cjs` rename (the fix the Node runtime error
  itself recommends). Do NOT add a `netlify/functions/package.json` with
  `"type": "commonjs"` instead — the deploy bundler flattens the function file
  to `/var/task/` next to the root package.json, so a nested package.json is
  not guaranteed to govern module parsing there. A file extension always is.
- Netlify endpoint names are derived from the filename without extension, so
  `/.netlify/functions/genai-proxy` and `/.netlify/functions/provider-adapter`
  URLs are unchanged. Frontend endpoint constants in `src/ai/geminiAdapter.ts`
  and `src/services/translationService.ts` need no edits.
- The three files are standalone CJS (no cross-requires; each requires only
  `@google/genai`). `scripts/provider-dry-run.mjs` loads
  `netlify/functions/provider-adapter.js` by filesystem path and must be
  updated to the `.cjs` path.
- Use `git mv` for the renames so history follows.
- Scope boundary: no logic changes inside the function bodies; no changes to
  frontend code, `netlify.toml`, or root `package.json`.
- Dependencies: none.
- Parallel wave: runs alone.

## Allowed changes

- `netlify/functions/genai-proxy.js` → `netlify/functions/genai-proxy.cjs` (rename only)
- `netlify/functions/provider-adapter.js` → `netlify/functions/provider-adapter.cjs` (rename only)
- `netlify/functions/model-adapter.js` → `netlify/functions/model-adapter.cjs` (rename only)
- `scripts/provider-dry-run.mjs` (path constant + stale path comments only)
- `netlify/__tests__/genai-proxy.test.js`, `netlify/__tests__/model-adapter.test.js`,
  `netlify/__tests__/provider-adapter.test.js` (source-path constants only —
  these read the function source by filesystem path; discovered during
  implementation, card amended by coordinator)

## Do not change

- Function body logic, exports, or headers.
- `netlify.toml`, root `package.json`, frontend endpoint constants.
- Unrelated code, credentials, deployment configuration, or other task cards.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. All three function files exist only with `.cjs` extensions; `git status`
   shows renames (no content diff besides `scripts/provider-dry-run.mjs`).
2. Each `.cjs` file loads as CommonJS from the repo root (which is under
   `"type": "module"`), proving the production crash is fixed at the module
   system level.
3. `genai-proxy` OPTIONS handler returns its CORS preflight response when
   invoked in-process (no network, no API key needed).
4. `node scripts/provider-dry-run.mjs` still runs zero-network and reports
   against the renamed adapter.
5. `npm run test:run` passes (268 tests) and `npm run build` succeeds.

## Verification

```bash
node -e "const m=require('./netlify/functions/genai-proxy.cjs'); if(typeof m.handler!=='function')process.exit(1); console.log('genai-proxy CJS OK')"
node -e "const m=require('./netlify/functions/provider-adapter.cjs'); if(typeof m.handler!=='function')process.exit(1); console.log('provider-adapter CJS OK')"
node -e "const m=require('./netlify/functions/model-adapter.cjs'); if(typeof m.handler!=='function')process.exit(1); console.log('model-adapter CJS OK')"
node -e "require('./netlify/functions/genai-proxy.cjs').handler({httpMethod:'OPTIONS',headers:{}}).then(r=>{console.log('OPTIONS status',r.statusCode); if(r.statusCode>=400)process.exit(1)})"
node scripts/provider-dry-run.mjs
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/netlify-functions-cjs-fix.md`
- The worker must set this card to `Ready for review` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
