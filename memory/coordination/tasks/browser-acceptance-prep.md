# Task: browser-acceptance-prep

## Status

Accepted

## Objective

Create a concrete browser acceptance checklist for the public demo, covering local preview and owner-run production checks.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`

## Context

- Relevant decisions and files: `PROJECT_STATE.md` and `progress-report.md` require full browser acceptance for 9-player and 12-player games, special roles, Gemini fallback, login, records, Supabase, and Netlify behavior.
- Scope boundary: documentation and acceptance procedure only; do not run deployment or change product code.
- Dependencies: `none`.
- Parallel wave: Wave 2; may run concurrently with `netlify-csp`.

## Allowed changes

- `docs/public-demo-browser-acceptance.md`

## Do not change

- Unrelated code, credentials, deployment configuration, or other task cards.
- App source files, Netlify files, Supabase SQL, generated build output, and online configuration.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. The checklist includes exact local commands for production preview and what the human/browser tester should verify.
2. It covers 9-player and 12-player complete playthroughs, each special role, login/OTP, records persistence, offline/Gemini fallback, and visible CSP/network-console checks.
3. It separates local-verifiable steps from owner-only production/Supabase/Netlify checks and includes pass/fail evidence fields.

## Verification

```bash
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/browser-acceptance-prep.md`
- The worker must set this card to `Accepted` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
