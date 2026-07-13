# AI Werewolf Coordination Workflow

This file is the durable protocol for the Codex multi-agent workflow. Claude Code
is the coordinator/architect; Codex provides three role workers. Shared state
lives in `memory/coordination/`, never in private session memory.

## Roles

| Role | Skill | Owns | Returns to Claude Code |
| --- | --- | --- | --- |
| Coordinator | `/codex-orchestrator` (Claude Code) | Plan, dispatch, review, integrate, verify, commit/push, deploy | — |
| Planner | `$aiwerewolf-planner` | Decompose a requirement into bounded task cards | Report path + created card paths |
| Coder | `$aiwerewolf-coder` | Implement one card in a resumable worktree session | Report path + changed file paths + one-line status |
| Debugger | `$aiwerewolf-debugger` | Review one card's result against acceptance criteria | Verdict (PASS/FAIL) + review path + files needing repair |

Workers never return code, diffs, or full transcripts to the coordinator — only
paths and verdicts. The paths and reports carry the detail.

## Pipeline

1. Coordinator receives a requirement via `/codex-orchestrator <requirement>`.
2. **Plan** — dispatch one planner over the remaining work pool. It writes
   non-overlapping cards under `tasks/` and a planning report.
3. Coordinator reviews the cards, sets the queue and parallel waves.
4. **Code loop** — for each card, dispatch the coder ↔ debugger loop:
   - coder round 1 implements and reports; its session id is captured;
   - debugger reviews, reproduces verification, writes `<task-id>-review.md`
     ending with `VERDICT: PASS` or `VERDICT: FAIL`;
   - on FAIL, the SAME coder session is resumed (`codex exec resume <id>`) with
     the debugger findings, so the coder keeps its context across rounds;
   - loop until `VERDICT: PASS` or the round limit.
5. Coordinator reviews each PASS patch, integrates accepted patches sequentially,
   runs `npm run test:run` and `npm run build`, then marks `Accepted` and updates
   `PROJECT_STATE.md`.
6. Coordinator reports the deployment's changes/optimizations, waits for owner
   approval, then deploys.
7. Cleanup the worktree; preserve reports and run logs under `runs/`.

## Concurrency and isolation

- Default concurrency limit is 10, chosen by task difficulty.
- A parallel wave contains only dependency-free cards with non-overlapping
  allowed paths.
- Each worker runs in its own detached Git worktree started from Git `HEAD`;
  uncommitted product changes are not inherited. The dispatcher copies shared
  memory and the assigned card into each worktree.

## Scripts (`~/.claude/skills/codex-orchestrator/scripts/`)

- `codex-role-loop.sh plan --requirement <slug> "<text>"` — planner pass.
- `codex-role-loop.sh code <task-id> [--max-rounds N]` — coder ↔ debugger loop.
- `codex-dispatch-parallel.sh [--max-workers N] <task-id...>` — generic worker
  fan-out (compatibility).
- `codex-integrate-worker.sh <task-id>` — apply an accepted patch.
- `codex-cleanup-worker.sh <task-id>` — remove a worktree, keep reports/logs.

## Boundaries

- Codex CLI: `codex` (Homebrew, `/opt/homebrew/bin/codex`).
- Workers must not commit, merge, rebase, manage other worktrees, or edit
  `PROJECT_STATE.md`.
- Rule logic stays in `gameEngine.ts` / `beliefTracker` / `actionSelector`; the
  LLM layer only shapes expression. `src/services/aiPlayer.ts` is legacy/unused.
- Never place secrets, raw terminal transcripts, or private conversation history
  in `memory/coordination/`.
- No deploy, online Supabase/Netlify change, commit, or push without the owner's
  explicit approval of the described change.
