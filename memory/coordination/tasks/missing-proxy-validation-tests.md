# Task: missing-proxy-validation-tests

## Status

Accepted

## Objective

Add focused tests for Gemini proxy request validation, CORS behavior, and safe error handling.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`

## Context

- Relevant decisions and files: `netlify/functions/genai-proxy.js` enforces API key isolation, CORS, method checks, prompt length, model whitelist, MIME type, temperature bounds, and rate limiting.
- Scope boundary: add tests for existing proxy behavior only; do not change production proxy code in this card.
- Dependencies: `none`.
- Parallel wave: Wave 1; may run concurrently with `legacy-ai-player-cleanup`, `type-safety-cleanup`, `seo-robots`, and `missing-auth-supabase-tests`.

## Allowed changes

- `netlify/functions/genai-proxy.test.js`

## Do not change

- Unrelated code, credentials, deployment configuration, or other task cards.
- `netlify/functions/genai-proxy.js`, `netlify.toml`, app source files, and package scripts.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. Tests mock `@google/genai` and do not call the real Gemini API.
2. Tests cover OPTIONS, non-POST rejection, missing prompt, model fallback, prompt truncation, and non-leaking internal errors.
3. Tests isolate environment variables and module state so rate limiting and API key state do not make the suite flaky.

## Verification

```bash
npm run test:run -- netlify/functions/genai-proxy.test.js
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/missing-proxy-validation-tests.md`
- The worker must set this card to `Accepted` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.

## Result summary

Added focused Gemini proxy validation tests covering preflight CORS, method
rejection, missing prompt validation, model fallback, prompt truncation, and
generic internal error responses. Verification passed with Vitest cache disabled
because the sandbox cannot write `node_modules/.vite/vitest/results.json`.
