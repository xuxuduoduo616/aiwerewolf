# Task: legacy-ai-player-cleanup

## Status

Accepted

Deleted the unused legacy AI implementation. The active AI entry point remains
`src/ai/aiOrchestrator.ts`; verification found no imports of the removed file.
Build passes, and all 14 Vitest tests pass with cache disabled. The exact
`npm run test:run` command executed the full suite successfully but exited
nonzero when the sandbox blocked Vitest from writing its results cache through
the shared `node_modules` symlink.

## Objective

Remove the unused legacy AI player implementation and prove the active AI path still builds and tests.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`

## Context

- Relevant decisions and files: `src/services/aiPlayer.ts` is documented as legacy and unused; `src/ai/aiOrchestrator.ts` is the active AI entry point.
- Scope boundary: delete dead legacy code only; do not migrate behavior from `aiPlayer.ts` into active AI modules.
- Dependencies: `none`.
- Parallel wave: Wave 1; may run concurrently with `type-safety-cleanup`, `seo-robots`, `missing-auth-supabase-tests`, and `missing-proxy-validation-tests`.

## Allowed changes

- `src/services/aiPlayer.ts`

## Do not change

- Unrelated code, credentials, deployment configuration, or other task cards.
- `src/ai/aiOrchestrator.ts`, `src/ai/actionSelector.ts`, `src/ai/beliefTracker.ts`, and rule logic.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. `src/services/aiPlayer.ts` is removed from the codebase.
2. No remaining source, test, or configuration import references `src/services/aiPlayer.ts` or its exports.
3. Active AI behavior remains routed through `src/ai/aiOrchestrator.ts`.

## Verification

```bash
rg "aiPlayer|services/aiPlayer" src netlify docs index.html package.json
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/legacy-ai-player-cleanup.md`
- The worker must set this card to `Accepted` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.
