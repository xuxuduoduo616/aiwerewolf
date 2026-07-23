---
timestamp: 2026-07-22T14:30:00Z
agent: Claude Code (coordinator)
role: coordinator
task_id: Session handoff
base_commit: cad0434
---

# Delta: Coordinator session handoff (2026-07-22)

## Changed — pre-existing on main branch (cad0434)
- Mobile shell UI overhaul (GlobalShell, BottomNav, TopStatusBar, LobbyHome, MatchSelection, etc.) committed and deployed.
- `netlify/functions/provider-adapter.cjs` (multi-model routing) authored and tested — not yet deployed to production. Duplicate `.js` copy was deployed 2026-07-07 but has since been superseded or refined.
- Turnstile integration, game-view fullscreen fix, updated `.env.example` reflecting Cloudflare Turnstile key.
- Supabase publishable key (`sb_publishable_...`) is the active frontend key; legacy JWT anon key also available.

## Evidence
- Site live: `https://ai-werewolf.net` HTTP 200
- Gemini proxy live: `{"text":"Hi there!"}` via `genai-proxy.js`
- Memory structure valid: `npm run memory:validate` → PASS
- Build clean: `npm run build` → ✓ built in ~1s
- Tests: 363 passed / 5 skipped (30 files)

## Blockers: none (deploy gate only)
- CLI-based Netlify deploy blocked by expired auth token (intermittent — owner must re-auth via browser).
- Netlify auto-deploy from GitHub push is NOT configured; manual deploy or dashboard manual trigger required for new changes.

## Next — where to pick up in a new session
1. Read `memory/INDEX.md` → `PROJECT_STATE.md` → this delta.
2. Run `npx netlify-cli login` (owner must authenticate in browser) then `npx netlify-cli link --name aiwerewolf` to restore CLI deploy ability.
3. If provider-adapter multi-model routing is needed: deploy `netlify/functions/provider-adapter.cjs` (commit and push), then add env vars for each model API key.
4. Continue polishing cycle: play-test the deployed site, collect gameplay bugs, fix per user feedback.
5. Next major feature pool: multi-model per-player AI personas (GPT/Claude/DeepSeek/Doubao on different seats).

## Canonical targets
- `memory/coordination/PROJECT_STATE.md`: update baseline to `cad0434`, note Turnstile + mobile UI + multi-model adapter
- `memory/progress-report.md`: queue multi-model routing deployment (provider-adapter.cjs) + per-player AI model personas
