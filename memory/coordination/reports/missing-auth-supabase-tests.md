# Report: missing-auth-supabase-tests

## Outcome

Added focused unit tests for existing Supabase client behavior. The tests mock
`@supabase/supabase-js`, verify the successful email OTP flow through profile
upsert and recent record fetch, assert profile/record mapping, and cover an OTP
failure path that surfaces the Supabase SDK error without table calls.

Status: Ready for review.

## Changed files

- `src/services/supabaseClient.test.ts`
- `memory/coordination/tasks/missing-auth-supabase-tests.md`
- `memory/coordination/reports/missing-auth-supabase-tests.md`

## Verification

- `npm run test:run -- src/services/supabaseClient.test.ts`
  - Test assertions passed: 1 file, 2 tests.
  - Process exited nonzero only because Vitest attempted to write
    `node_modules/.vite/vitest/results.json` through the worktree's
    `node_modules` symlink, which is outside this worker's writable sandbox.
- `npm run test:run -- --no-cache src/services/supabaseClient.test.ts`
  - Passed: 1 file, 2 tests.
- `npm run test:run -- --no-cache`
  - Passed: 3 files, 16 tests.
- `npm run build`
  - Passed.
  - Existing non-blocking Vite warning remains: `geminiAdapter.ts` is both
    dynamically and statically imported by `aiOrchestrator.ts`.

## Decisions and risks

- Did not change Supabase auth/source code; this card only adds tests for
  existing behavior.
- Used dynamic module imports after `vi.stubEnv` because `supabaseClient.ts`
  captures Vite env values at module load time.
- The tests use no real network calls, credentials, or live Supabase state.
- The literal Vitest commands may still hit the cache-write issue in this
  isolated worktree unless the coordinator runs in an environment where
  `node_modules/.vite` is writable or disables Vitest cache.

## Handoff

Recommendation: review and accept if the coordinator is satisfied with the
cache-disabled verification evidence. No follow-up source-code change is needed
for this card.
