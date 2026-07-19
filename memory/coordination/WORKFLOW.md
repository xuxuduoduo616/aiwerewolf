# AI Werewolf Coordination Workflow

Durable protocol for Claude Code ↔ Codex multi-agent dispatch. Shared state
in `memory/coordination/`.

## Roles (2026-07-19)

| Role | Tool | Owns | Returns |
| --- | --- | --- | --- |
| Coordinator | `/codex-orchestrator` (Claude Code) | Plan, dispatch, review, integrate, verify, commit/push, deploy, PROJECT_STATE | — |
| Worker | `$aiwerewolf-worker` (Codex CLI) | One task card per isolated worktree | Report + patch + one-line status |

The planner/coder/debugger triple (`~/.codex/skills/aiwerewolf-{planner,coder,debugger}/`) is archived. All workers use the unified `aiwerewolf-worker` skill.

## Pipeline

1. Coordinator receives a requirement via `/codex-orchestrator <requirement>`.
2. Coordinator reads shared memory + git status, decomposes the requirement
   into task cards, writes them to `memory/coordination/tasks/<task-id>.md`
   (from `TASK_TEMPLATE.md`).
3. Cards must have non-overlapping allowed paths and independent verification
   to run in one parallel wave. Default max 3 workers.
4. **Dispatch** via `codex-dispatch-parallel.sh` (or direct `codex exec`):
   workers run in isolated git worktrees under `.codex-worker-worktrees/`.
   Worktrees start from `git HEAD` — no uncommitted product changes inherited.
5. Each worker reads AGENTS.md + PROJECT_STATE + its task card, implements,
   verifies, writes `reports/<task-id>.md`, sets card to `Ready for review` or
   `Blocked`.
6. Coordinator reviews each report + patch + verification evidence.
7. **Integrate**: accepted patches applied via `codex-integrate-worker.sh`.
   Run `npm run test:run` + `npm run build` after each integration batch.
8. Mark `Accepted` in task card, update PROJECT_STATE.
9. **Cleanup**: `codex-cleanup-worker.sh` removes worktree, preserves reports/logs.

## Scripts

| Script | Path | Purpose |
|--------|------|---------|
| Parallel dispatch | `~/.claude/skills/codex-orchestrator/scripts/codex-dispatch-parallel.sh` | Fan-out workers, max N at a time |
| Single dispatch | `~/.claude/skills/codex-orchestrator/scripts/codex-dispatch.sh` | Wraps parallel with `--max-workers 1` |
| Model preflight | `~/.claude/skills/codex-orchestrator/scripts/codex-model-preflight.sh` | Probe gpt-5.6 availability before dispatch |
| Integration | `~/.claude/skills/codex-orchestrator/scripts/codex-integrate-worker.sh` | Gate (PASS + Ready for review) → git apply |
| Cleanup | `~/.claude/skills/codex-orchestrator/scripts/codex-cleanup-worker.sh` | git worktree remove + prune |

## Script friction (known)

`codex-dispatch-parallel.sh` line 56-61 requires `CODEX_MODEL=gpt-5.6-*` in env
or FATAL-exits. The active project Codex provider is `deepseek-v4-flash`. When
dispatching, coordinator must either:

- Run `codex-model-preflight.sh` first to check gpt-5.6 reachability, or
- `export CODEX_MODEL=<actual-model>` before calling the dispatch script, or
- Bypass the script and call `codex exec` directly with the active model.

The coordinator decides per-session which path to take.

## Worker sandbox

```bash
codex exec \
  --cd "$worktree" \
  --sandbox workspace-write \
  -c approval_policy="never" \
  -m "$CODEX_MODEL" \
  --json \
  --output-last-message "$final_file" \
  "$prompt"
```

Codex 0.144.1, sandbox `workspace-write`, approval `never`.

## Concurrency and isolation

- Default max 3 parallel workers.
- Workers start from detached git worktree from `HEAD`.
- Shared memory + task card copied into each worktree.
- `node_modules` symlinked to project root to avoid reinstall.
- Worktrees under `.codex-worker-worktrees/` (gitignored).
- `memory/coordination/runs/` stores events, patches, metadata per run.

## Boundaries

- Workers must not commit, merge, rebase, manage worktrees, or edit PROJECT_STATE.
- Rule logic stays in `gameEngine.ts`/`beliefTracker`/`actionSelector`; LLM layer shapes expression.
- `src/services/aiPlayer.ts` is legacy/unused (pending deletion via task card).
- No deploy, Supabase/Netlify change, commit, or push without owner approval.
- Secrets, raw transcripts, private session history never go into `memory/coordination/`.
