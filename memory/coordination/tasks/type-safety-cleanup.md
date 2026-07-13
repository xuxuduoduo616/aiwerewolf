# Task: type-safety-cleanup

## Status

Accepted

## Objective

Replace the known `any` usages in auth and AI action dispatch, and remove the Gemini adapter import warning, without changing runtime behavior.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `memory/progress-report.md`

## Context

- Relevant decisions and files: `memory/progress-report.md` identifies `src/hooks/useAuth.ts` `any` usages, the `type as any` cast in `src/ai/aiOrchestrator.ts`, and the build warning caused by static plus dynamic imports of `geminiAdapter.ts`.
- Scope boundary: type and import cleanup only; no behavior changes to OTP, session restore, records loading, AI decisions, Gemini calls, or LLM fallback.
- Dependencies: `none`.
- Parallel wave: Wave 1; may run concurrently with `legacy-ai-player-cleanup`, `seo-robots`, `missing-auth-supabase-tests`, and `missing-proxy-validation-tests`.

## Allowed changes

- `src/hooks/useAuth.ts`
- `src/ai/aiOrchestrator.ts`

## Do not change

- Unrelated code, credentials, deployment configuration, or other task cards.
- `src/services/aiPlayer.ts`, `src/ai/geminiAdapter.ts`, `src/services/supabaseClient.ts`, and existing tests.
- Game rules, `src/ai/actionSelector.ts`, and `src/ai/beliefTracker.ts`.
- Git branches, commits, merges, rebases, worktree configuration, and
  `memory/coordination/PROJECT_STATE.md`.

## Acceptance criteria

1. `src/hooks/useAuth.ts` no longer uses explicit `any`; callback and error handling use typed values or safe narrowing.
2. `src/ai/aiOrchestrator.ts` no longer casts the action type with `as any` when calling `selectAction`.
3. The production build no longer emits the static/dynamic import warning for `geminiAdapter.ts`.
4. Public hook return shape, generated AI action behavior, Gemini calls, and fallbacks are unchanged.

## Verification

```bash
rg "\\bany\\b|as any" src/hooks/useAuth.ts src/ai/aiOrchestrator.ts
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/type-safety-cleanup.md`
- The worker must set this card to `Accepted` or `Blocked` and add a concise result summary.
- The report must include changed files, verification commands and results,
  decisions, residual risks, and a recommendation to the coordinator.

## Result summary

Replaced explicit `any` usage in auth with `GameRecord[]` and `unknown` error
narrowing, removed the action selector cast by using the existing `ActionType`,
and made Gemini adapter usage consistently dynamic so the production build no
longer emits the static/dynamic import warning. Verification is recorded in
`memory/coordination/reports/type-safety-cleanup.md`.
