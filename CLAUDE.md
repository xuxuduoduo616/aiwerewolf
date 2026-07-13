# AI Werewolf: Claude Code Entry Point

@AGENTS.md
@memory/coordination/PROJECT_STATE.md
@memory/coordination/WORKFLOW.md
@memory/project-overview.md
@memory/progress-report.md

Treat the imported files as project memory. Re-read the applicable task card
and worker report after any Codex handoff; do not rely on private session memory
for project status.

## Workflow entry points

- Claude Code coordinator command: `/codex-orchestrator <requirement>`.
- Three Codex role skills — `$aiwerewolf-planner` (task decomposition),
  `$aiwerewolf-coder` (implementation, resumable session), `$aiwerewolf-debugger`
  (review and verification). See `memory/coordination/WORKFLOW.md`.
- Claude Code plans, commits, deploys, and manages online Supabase/Netlify;
  Codex implements one task card inside an isolated Git worktree.
- Independent, non-overlapping tasks run in parallel waves with a maximum of
  10 workers, chosen by task difficulty. Accepted patches are applied
  sequentially and verified before `PROJECT_STATE.md` is updated.
- Each deployment must be pre-approved by the project owner after a briefing
  of changes, fixes, risks, and rollback options.
