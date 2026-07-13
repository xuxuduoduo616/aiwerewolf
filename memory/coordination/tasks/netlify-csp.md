# Task: netlify-csp

## Status

Accepted

## Objective

Add a restrictive Netlify Content-Security-Policy header that permits only the app's actual browser dependencies.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`

## Context

- Relevant decisions and files: `netlify.toml` has security headers but no CSP; known browser dependencies include self-hosted app assets, Google Fonts CSS/font files, Supabase project URL from env, same-origin Netlify functions, and DiceBear avatars if still used by the app.
- Scope boundary: static Netlify header configuration only; do not modify online Netlify settings or credentials.
- Dependencies: `none`.
- Parallel wave: Wave 2; may run concurrently with `browser-acceptance-prep`.

## Allowed changes

- `netlify.toml`

## Do not change

- Unrelated code, credentials, deployment configuration, or other task cards.
- App source files, Netlify functions, generated build output, `.env*`, and online Netlify configuration.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. `netlify.toml` defines a `Content-Security-Policy` header for `/*` that avoids `default-src *`.
2. The policy explicitly accounts for current app needs: scripts/styles for Vite output, Google Fonts, images/data URLs/DiceBear if used, Supabase HTTPS/WSS endpoints, and same-origin Netlify function calls.
3. The policy keeps frame/object permissions restrictive and does not include broad unsafe sources except where required by the current Vite/React build and documented in the report.

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/netlify-csp.md`
- The worker must set this card to `Accepted` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.

## Result summary

Added a restrictive CSP in `netlify.toml`; verification passes with Vitest cache disabled in this sandbox and the production build passes.
