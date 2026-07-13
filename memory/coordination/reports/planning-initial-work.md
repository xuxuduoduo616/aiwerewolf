# Report: planning-initial-work

## Task cards created

- `legacy-ai-player-cleanup` — delete unused `src/services/aiPlayer.ts` and prove no imports/regression; allowed paths: `src/services/aiPlayer.ts`; dependencies: `none`; wave 1.
- `type-safety-cleanup` — remove known `any` usages in auth and AI action dispatch and fix the Gemini adapter import warning; allowed paths: `src/hooks/useAuth.ts`, `src/ai/aiOrchestrator.ts`; dependencies: `none`; wave 1.
- `seo-robots` — add public-demo metadata and crawler guidance; allowed paths: `index.html`, `public/robots.txt`; dependencies: `none`; wave 1.
- `missing-auth-supabase-tests` — add mocked Supabase auth/client mapping tests; allowed paths: `src/services/supabaseClient.test.ts`; dependencies: `none`; wave 1.
- `missing-proxy-validation-tests` — add mocked Gemini proxy validation/CORS/error tests; allowed paths: `netlify/functions/genai-proxy.test.js`; dependencies: `none`; wave 1.
- `netlify-csp` — add restrictive Netlify CSP for the demo surface; allowed paths: `netlify.toml`; dependencies: `none`; wave 2.
- `browser-acceptance-prep` — create a browser acceptance checklist for local preview and owner-run production checks; allowed paths: `docs/public-demo-browser-acceptance.md`; dependencies: `none`; wave 2.

## Proposed waves

Wave 1, concurrency 5:

- `legacy-ai-player-cleanup`
- `type-safety-cleanup`
- `seo-robots`
- `missing-auth-supabase-tests`
- `missing-proxy-validation-tests`

Wave 2, concurrency 2:

- `netlify-csp`
- `browser-acceptance-prep`

Coordinator note: every card has disjoint allowed paths across the whole queue. Wave 2 is later only for sequencing quality: CSP and browser acceptance preparation should be easiest after wave 1 has settled, but their cards do not require future task dependencies.

## Risks and open decisions

- The two test cards are intentionally test-only. If either discovers production code changes are required, the worker should mark the card `Blocked` and report the exact source file(s), so the coordinator can create a repair card without violating path ownership.
- `type-safety-cleanup` now includes the build-warning cleanup because both gaps live in `src/ai/aiOrchestrator.ts`; keeping them together avoids overlapping card ownership.
- `netlify-csp` must infer runtime origins from source and environment variable names, not from live Netlify settings. The owner still needs to verify the deployed CSP against the real Supabase project URL and domain.
- `browser-acceptance-prep` creates a checklist, not an executed acceptance record. The actual 9-player and 12-player browser playthrough remains a coordinator/owner verification activity after patches are integrated.
- No card changes credentials, online Supabase/Netlify configuration, deployment state, commits, or `memory/coordination/PROJECT_STATE.md`.

## Recommendation to coordinator

Dispatch wave 1 with five workers. After accepting and integrating those patches, run combined `npm run test:run` and `npm run build`, then dispatch wave 2. Execute the resulting browser acceptance checklist before requesting owner approval for any deployment.
