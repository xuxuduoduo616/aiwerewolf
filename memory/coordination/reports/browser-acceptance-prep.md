# Report: browser-acceptance-prep

## Outcome

Created `docs/public-demo-browser-acceptance.md`, a concrete browser acceptance checklist for the public demo. The checklist separates local production preview checks from owner-only production, Supabase, and Netlify checks, and includes evidence/pass-fail fields for each item.

The task card is set to `Ready for review`.

Resume round update: the exact required `npm run test:run` command now exits successfully in this worktree after repairing the local `node_modules` layout so Vitest can write its cache inside the worker scope.

## Changed files

- `docs/public-demo-browser-acceptance.md`
- `memory/coordination/tasks/browser-acceptance-prep.md`
- `memory/coordination/reports/browser-acceptance-prep.md`

## Verification

- `npm run test:run` passed: 4 test files, 22 tests.
- `npm run build` passed: TypeScript and Vite production build completed successfully.

## Decisions and risks

- Kept the change documentation-only and did not edit product code, Netlify config, Supabase SQL, credentials, deployment config, or `PROJECT_STATE.md`.
- Included local commands for production preview: `npm install`, `npm run build`, and `npm run preview -- --host 127.0.0.1 --port 4173`.
- Covered 9-player and 12-player complete playthroughs, seer, witch, hunter, idiot, werewolf, login/OTP, records persistence, offline/Gemini fallback, CSP, CORS, Netlify function behavior, and Supabase RLS checks.
- Production, Supabase, OTP, and Netlify behavior remain owner-only external checks; this task only documents the acceptance procedure.
- The earlier Vitest cache-write failure was environmental and is resolved in this worktree; no product behavior changed.

## Handoff

Recommendation: review the checklist for any owner-preferred evidence format, then accept and use it as the public demo browser QA runbook before deployment approval.
