---
agent: coordinator (Claude Code)
timestamp: 2026-07-19T16:45:00Z
base_commit: 1e3a816
---

# Handoff Delta — Framework Init

## What happened this session

- User invoked `/migrate-to-codex` (project scope): generated
  `AGENTS.md` symlink, `.codex/config.toml` (supabase MCP), and
  `.agents/skills/codex-orchestrator/`. Fixed `${CLAUDE_SKILL_DIR}` →
  `${AGENTS_SKILL_DIR}` and rewrote `allowed-tools` block as guidance.
  Supabase OAuth block dropped (Codex doesn't parse it).

- User invoked `/codex-orchestrator` with initialization instructions.
  Full framework check completed and documented.

## Verified facts

- Git HEAD: `1e3a816`, no uncommitted tracked changes (only new untracked
  M files in memory/ + AGENTS.md + CLAUDE.md).
- Codex CLI: 0.144.1 at `/opt/homebrew/bin/codex`, confirmed in PATH.
- Active provider: `deepseek-v4-flash` via custom proxy (`127.0.0.1:15721/v1`).
- Scripts: dispatch-parallel, dispatch, integrate, cleanup, model-preflight
  all present and functional. Caution: dispatch-parallel.sh lines 56-61
  require `CODEX_MODEL=gpt-5.6-*` in env or FATAL-exits.
- Memory: validate PASS, audit PASS. CLAUDE.md now links `memory/INDEX.md`.

## Canonical files updated this session

- `memory/coordination/PROJECT_STATE.md` — framework architecture, friction
  points, corrected task pool
- `memory/coordination/WORKFLOW.md` — unified worker model, pipeline steps,
  script paths, sandbox params
- `memory/progress-report.md` — corrected task waves, stale-card note
- `memory/decisions/ADR-002-framework-initialization.md` — NEW
- `CLAUDE.md` — dispatch preflight checklist + INDEX link
- `AGENTS.md` — worker entry for unified model
- `.codex/config.toml` — project Codex config (supabase MCP, personality)

## Decisions

- Worker model: unified `$aiwerewolf-worker` (old planner/coder/debugger
  triple archived).
- Dispatch is hybrid: use scripts if gpt-5.6 reachable, else `codex exec`
  directly with active provider model.
- Wave 1 ready: `legacy-ai-player-cleanup`, `type-safety-cleanup`,
  `seo-robots`. Non-overlapping paths, no deps.

## Next

下次 `/codex-orchestrator` 调用时直接进入派发流程：
1. 确认 git status clean
2. 确认 CODEX_MODEL（或跑 preflight）
3. 写入三张 Wave 1 task cards（用 TASK_TEMPLATE.md）
4. 并行派发 max 3 workers
5. 审查报告 → 集成 → 验证 → 标记 Accepted
