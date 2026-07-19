# Project Coordination State

**Last verified:** 2026-07-19 (Cycle 8 UI overhaul integrated)
**Project phase:** Cycles 1–8 complete (31 cards Accepted) + memory governance + sync-project-memory skill. Deployed `a027296` verified live 2026-07-18. **Cycle 8 UI overhaul integrated 2026-07-19 (local only, not deployed).**

## Verified Baseline

- Local tests: `npm run test:run` — **363 passed / 5 skipped** (29 files), zero regressions. `npm run build` succeeds.
- Local HEAD = `143860d` (stale — repo has no live-change commits; production tip is `a027296`).
- Production = `a027296` (asset `index-BOYeqKxJ.js` verified live 2026-07-18).
- Git has uncommitted product changes (Cycle 8 UI overhaul — 18 new/edited files).
- Untracked: `.codex/`, `.agents/`, `.claude/`, `.mcp.json`, `memory/`, `AGENTS.md`, `CLAUDE.md`, `.env.example`, screenshot artifacts.
- Coordination directories `tasks/`, `reports/`, `runs/` are EMPTY — ready for fresh dispatch.

## Framework Architecture (2026-07-19)

### Roles

| Role | Tool | Owns |
|------|------|------|
| Coordinator/Architect | Claude Code (`/codex-orchestrator`) | Plan, dispatch, review, integrate, verify, commit, PROJECT_STATE |
| Worker | Codex CLI (`codex exec`, `$aiwerewolf-worker` skill) | One task card per isolated worktree |

The old planner/coder/debugger triple split is archived (skills at `~/.codex/skills/aiwerewolf-{planner,coder,debugger}/` preserved but unused). The unified `aiwerewolf-worker` skill is the dispatch target.

### Script infrastructure

| Script | Path | Status |
|--------|------|--------|
| Parallel dispatch | `~/.claude/skills/codex-orchestrator/scripts/codex-dispatch-parallel.sh` | Present |
| Single dispatch | `~/.claude/skills/codex-orchestrator/scripts/codex-dispatch.sh` | Present (wraps parallel with `--max-workers 1`) |
| Integration | `~/.claude/skills/codex-orchestrator/scripts/codex-integrate-worker.sh` | Present |
| Cleanup | `~/.claude/skills/codex-orchestrator/scripts/codex-cleanup-worker.sh` | Present |
| Model preflight | `~/.claude/skills/codex-orchestrator/scripts/codex-model-preflight.sh` | Present (probes gpt-5.6 only) |

### Runtime environment

| Item | Value |
|------|-------|
| Codex CLI | 0.144.1 (Homebrew, `/opt/homebrew/bin/codex`) |
| codex in PATH | Yes (confirmed this session) |
| OpenAI Codex provider | `deepseek-v4-flash` via custom provider (`http://127.0.0.1:15721/v1`) |
| Project codex config | `.codex/config.toml` (personality=friendly, supabase MCP) |
| Global codex config | `~/.codex/config.toml` (personality=pragmatic, deepseek provider) |
| MCP servers (codex) | 2 stdio servers, 1 disabled |
| Sandbox | restricted fs + restricted network, approval OnRequest |

## Known Friction Points (pre-dispatch checklist)

### 1. CODEX_MODEL gate (BLOCKER for dispatch script)

`codex-dispatch-parallel.sh` lines 56-61 **hardcode** a `CODEX_MODEL=gpt-5.6-*` check and FATAL-exit if unset. The actual Codex provider is `deepseek-v4-flash`. Running the script without setting `CODEX_MODEL` to a gpt-5.6 model will fail.

**Workaround for coordinator**: when dispatching via bash, set `CODEX_MODEL` to the actual Codex model (e.g. `CODEX_MODEL=gpt-5.6-Sol` to probe, or bypass the script and call `codex exec` directly). The coordinator should either (a) run `codex-model-preflight.sh` first to check gpt-5.6 availability, (b) fall back to direct `codex exec` with the active provider model, or (c) patch the script to accept a `CODEX_MODEL` override.

**Owner decision needed**: whether to (a) attempt the gpt-5.6 probe each time, (b) patch the script, or (c) dispatch workers via direct `codex exec` bypassing the script.

### 2. Supabase MCP OAuth

Source `.mcp.json` uses OAuth auth block. Codex `.codex/config.toml` (project) only has the URL — the OAuth block was dropped during migration. First Codex session connecting to supabase MCP will require re-authentication.

### 3. approval_policy flag form

`codex-dispatch-parallel.sh` line 177 uses `-c approval_policy="never"`. Codex 0.144.1 supports this as a config override AND also has `-a never` as a dedicated flag. The `-c` form is confirmed working for 0.144.1.

### 4. Stale Codex skills under cc-switch

`~/.cc-switch/skills/` has 76 skills leftover from a prior Codex migration. The active skills are at `~/.codex/skills/`. The cc-switch path is dead and can be removed.

## Cycle 8: Mobile UI Overhaul (2026-07-19 — ACCEPTED, 5 cards)

| Card | Status |
|------|--------|
| `ui-global-shell` — mobile viewport, CSS design system, BottomNav, TopStatusBar, marquee | Accepted |
| `ui-lobby-home` — user profile panel, side menus, character showcase, activity banner, action buttons, chat preview | Accepted |
| `ui-match-selection` — wide card stack, 2-col grid, sub-tabs, role badges, countdown labels | Accepted |
| `ui-profile-inventory` — Outfits panel, Backpack panel, Skin collection gallery, ProfileView | Accepted |
| `ui-integration-wiring` — App.tsx shell wiring, view routing, bottom nav → content mapping, game view preserved | Accepted |

**New files (18):**
- `src/styles/mobile-shell.css` — shared design tokens, shell/layout/nav/marquee/filter/modal CSS
- `src/components/GlobalShell.tsx` — mobile viewport wrapper
- `src/components/BottomNav.tsx` — 5-tab bottom navigation (首页/好友/狼村/商店街/我的)
- `src/components/TopStatusBar.tsx` — currency bar (金币/点卷/狼神水晶) + marquee ticker
- `src/components/LobbyHome.tsx` — lobby view (profile panel, character showcase, side menus, action buttons, chat preview)
- `src/components/LobbySideMenus.tsx` — left/right circular icon menus with red dot badges
- `src/components/LobbyActionButtons.tsx` — 建房/跟房/观战 buttons
- `src/components/ActivityBanner.tsx` — horizontal scrollable activity banner cards
- `src/components/MatchSelection.tsx` — board/match browser with sub-tabs and two layout modes
- `src/components/MatchWideCard.tsx` — wide card with role badges and character art placeholder
- `src/components/MatchGridCard.tsx` — 2-column grid card with countdown
- `src/components/MatchSubTabs.tsx` — 4-item sub-tab bar
- `src/components/ProfileView.tsx` — 我的 view shell with 6 sub-tabs
- `src/components/ProfileSubTabs.tsx` — 6-item sub-tab bar
- `src/components/OutfitsPanel.tsx` — fitting room + quality filter + outfit grid
- `src/components/BackpackPanel.tsx` — 5-category filter + item grid with send-gift buttons
- `src/components/SkinCollectionPanel.tsx` — 3-category skin gallery with progress bars

**Modified:** `src/App.tsx` — GlobalShell wrapping, view routing, game view preserved inside shell

**Verified:** `npm run test:run` 363 passed / 5 skipped, `npm run build` green, zero regressions.

## Task Pool (corrected 2026-07-19)

### Wave 1 — parallel (non-overlapping paths, no deps)

| Task ID | Scope | Priority |
|---------|-------|----------|
| `legacy-ai-player-cleanup` | `src/services/aiPlayer.ts` delete only | P1 |
| `type-safety-cleanup` | `src/hooks/useAuth.ts`, `src/ai/aiOrchestrator.ts` tighten `any` | P1 |
| `seo-robots` | `index.html` metadata, `public/robots.txt` new file | P2 |

### Wave 2 — sequential (needs deploy verification)

| Task ID | Scope | Priority |
|---------|-------|----------|
| `netlify-csp` | `netlify.toml` CSP header | P1 (deploy-gated) |

### Owner-only (no codex worker)

- Supabase RLS / email template / OTP verification in Dashboard
- Netlify env vars / ALLOWED_ORIGIN check
- Full browser E2E (12p, all roles)

## Codex Migration Artifacts (project scope, 2026-07-19)

| Artifact | Type | Status |
|----------|------|--------|
| `AGENTS.md` | Symlink → CLAUDE.md | Created (1:1 forward) |
| `.codex/config.toml` | MCP + personality | Created (supabase OAuth noted as manual) |
| `.agents/skills/codex-orchestrator/SKILL.md` | Skill | Created (variables fixed, tool list → guidance) |
| `.agents/skills/codex-orchestrator/scripts/*` | Scripts | Copied (4 scripts, unchanged) |

## Coordinator Rules

- No deploy, push, or external service mutation without owner approval.
- Worktree dispatch from clean `git HEAD` only.
- If uncommitted product changes exist, commit or abort first.
- Never place secrets, raw transcripts, or private session history in `memory/coordination/`.
- Integration gate: `final_verdict=PASS` + status `Ready for review` → apply patch → `npm run test:run` + `npm run build` → mark `Accepted`.
