# Task: missing-auth-supabase-tests

## Status

Accepted

## Objective

Add focused unit coverage for Supabase auth/client mapping behavior that is currently only manually verified.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`

## Context

- Relevant decisions and files: `memory/progress-report.md` calls out missing auth and Supabase client tests; recent OTP work depends on fresh sessions and record/profile mapping.
- Scope boundary: add tests for existing behavior only; do not change auth source code in this card.
- Dependencies: `none`.
- Parallel wave: Wave 1; may run concurrently with `legacy-ai-player-cleanup`, `type-safety-cleanup`, `seo-robots`, and `missing-proxy-validation-tests`.

## Allowed changes

- `src/services/supabaseClient.test.ts`

## Do not change

- Unrelated code, credentials, deployment configuration, or other task cards.
- `src/hooks/useAuth.ts`, `src/services/supabaseClient.ts`, app source files, and Netlify files.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. Tests mock the Supabase SDK and cover successful OTP verification through profile upsert and record fetch mapping.
2. Tests cover at least one failure path that reports a user-facing Supabase error without using real network calls or credentials.
3. Tests are deterministic and fit the existing Vitest test suite.

## Verification

```bash
npm run test:run -- src/services/supabaseClient.test.ts
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/missing-auth-supabase-tests.md`
- The worker must set this card to `Accepted` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.

## Result summary

Added deterministic Vitest coverage for Supabase OTP verification, profile upsert,
record mapping, and SDK error propagation. Verification passes; see the worker
report for the sandbox-specific Vitest cache note.
