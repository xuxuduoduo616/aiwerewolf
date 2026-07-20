# ADR-002: Claude Code ↔ Codex Multi-Agent Framework

**Date:** 2026-07-19
**Status:** Accepted
**Author:** coordinator (Claude Code)

## Context

The project had a growing but untested multi-agent workflow vision (planner →
coder → debugger loop, worktree isolation, parallel dispatch). The orchestration
scripts existed on disk, but no task had ever been dispatched, no worktree had
ever been created, and no verification of the pipeline had been done.

The user formally invoked `/codex-orchestrator` with initialization instructions
that codified the framework contract. This ADR records the decisions made during
framework initialization and the known friction points.

## Decision

1. **Unified worker model**: The old planner/coder/debugger triple split is
   archived. All workers use the single `$aiwerewolf-worker` skill. The
   coordinator (Claude Code) handles all planning, review, and integration.

2. **Project-scope Codex migration completed**: `.mcp.json` → `.codex/config.toml`,
   `codex-orchestrator` skill moved to `.agents/skills/`, `AGENTS.md` symlinked
   to `CLAUDE.md`. The supabase MCP OAuth block was intentionally dropped
   (Codex doesn't parse it) — re-auth required on first use.

3. **Dispatch is hybrid**: The coordinator may use `codex-dispatch-parallel.sh`
   (if gpt-5.6 is reachable) OR call `codex exec` directly with the active
   provider model. The dispatch script's hard `CODEX_MODEL=gpt-5.6-*` gate
   (lines 56-61) is preserved as a valid path, not deleted.

4. **PATH is reliable**: `/opt/homebrew/bin/codex` (0.144.1) IS in this session's
   PATH. The prior "not on PATH" error was a non-issue.

5. **Two config.toml layers**: Project `.codex/config.toml` (personality=friendly,
   supabase MCP) stacks on global `~/.codex/config.toml` (personality=pragmatic,
   deepseek custom provider). Worker sessions inherit the merged config.

6. **Gitignore covers worker artifacts**: `.codex-worker-worktrees/` and
   `memory/coordination/runs/` are gitignored. Task cards and reports under
   `memory/coordination/tasks/` and `reports/` ARE versioned.

## Consequences

- Dispatch is possible immediately — scripts, skills, and config are in place.
- The `CODEX_MODEL` gate in `codex-dispatch-parallel.sh` is the only pre-check
  required before each dispatch session.
- `~/.cc-switch/skills/` (76 stale skills) should be cleaned up separately.
- Supabase MCP OAuth: re-auth prompt on first Codex MCP connect is expected
  and harmless.
- The old `memory/coordination/tasks/` pool (40+ cards from prior framework)
  is stale — coordinator must triage each before reuse.

## References

- [[coordination/PROJECT_STATE]]
- [[coordination/WORKFLOW]]
- [[progress-report]]
