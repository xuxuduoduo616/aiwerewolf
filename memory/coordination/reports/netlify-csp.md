# Report: netlify-csp

## Outcome

Added a restrictive Netlify Content-Security-Policy based on the app's actual external dependencies and kept it scoped to the existing global security header block.

Resume update: restored the full task card contents after debugger review found the copied card lacked acceptance criteria, allowed paths, and verification commands. No CSP product-code change was needed in this round.

## Changed files

- `netlify.toml`
- `memory/coordination/tasks/netlify-csp.md`
- `memory/coordination/reports/netlify-csp.md`

## Verification

- `npm run test:run` — Vitest tests passed, but the command exited nonzero because Vitest could not write `node_modules/.vite/vitest/results.json` in this sandbox.
- `npm run test:run -- --no-cache` — passed 4 files / 22 tests.
- `npm run build` — passed.

Resume verification:

- `npm run test:run` — reproduced the same sandbox cache write failure after 4 files / 22 tests passed.
- `npm run test:run -- --no-cache` — passed 4 files / 22 tests.
- `npm run build` — passed.

## Decisions and risks

- Allowed sources were limited to the dependencies present in the repo: same-origin scripts and APIs, Google Fonts for stylesheet/font loading, Supabase for auth/data sockets, DiceBear avatars, and data URLs for the favicon.
- `style-src` includes `'unsafe-inline'` as the only broad unsafe source retained for current Vite/React style compatibility; external style loading remains limited to Google Fonts.
- `connect-src` includes wildcard Supabase HTTPS/WSS endpoints so both auth and realtime-style browser connections remain functional.
- No deployment verification was attempted; this task only covers the code/config change and local build/test confirmation.

## Handoff

Ready for coordinator review.
