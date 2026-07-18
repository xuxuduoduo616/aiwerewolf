---
name: "codex-orchestrator"
description: "Act as the aiwerewolf architect: turn a user request into small tracked task cards, dispatch each coding task to an isolated Codex worker, then review its report and continue the loop. Use only when the user explicitly asks to delegate aiwerewolf implementation to Codex."
---

# Claude Code: AI Werewolf Coordinator

Act as the project architect and coordinator. Do not implement product code yourself.

1. Read `AGENTS.md`, `memory/coordination/PROJECT_STATE.md`, `memory/project-overview.md`, `memory/progress-report.md`, and current git status.
2. Clarify the requested outcome from the invocation argument (the feature or task text passed when this skill is invoked). Split it into task cards only where each task has a non-overlapping file scope and independent verification.
   Workers start from the current Git `HEAD`; do not dispatch a task that
   depends on uncommitted product-code changes. Commit an approved baseline or
   postpone that task first. The dispatcher copies the shared memory files and
   assigned task card separately.
3. For every task, create `memory/coordination/tasks/<task-id>.md` from `memory/coordination/TASK_TEMPLATE.md`. Specify objective, scope, exclusions, acceptance criteria, and exact verification commands. Update `PROJECT_STATE.md` with the queue.
4. Group only tasks whose allowed change paths do not overlap and which have no
   dependency on one another. Dispatch the group in parallel, with at most
   three workers by default:

```bash
bash "${AGENTS_SKILL_DIR}/scripts/codex-dispatch-parallel.sh" \
  --max-workers 3 "<task-a>" "<task-b>" "<task-c>"
```

Use `codex-dispatch.sh <task-id>` as the single-worker compatibility command.
Run dependent or overlapping tasks in later waves, only after their prerequisites
are accepted.
5. After the workers return, read every task card and report. Inspect each patch
   recorded under `memory/coordination/runs/` and the isolated worktree. Reject
   or request repair when scope, verification, or evidence is insufficient.
6. For each approved task, apply its patch to the coordinator worktree:

```bash
bash "${AGENTS_SKILL_DIR}/scripts/codex-integrate-worker.sh" "<task-id>"
```

Run `npm run test:run` and `npm run build` after each integration, or after a
compatible accepted batch. Only then mark the task `Accepted` and update
`PROJECT_STATE.md`. If integration conflicts, leave it unaccepted and create a
repair or rebase task.
7. After acceptance or deliberate rejection, clean its isolated worktree while
   preserving reports and local run logs:

```bash
bash "${AGENTS_SKILL_DIR}/scripts/codex-cleanup-worker.sh" "<task-id>"
```

Treat `memory/coordination/` as the durable handoff protocol. Never place secrets, raw terminal transcripts, or private Claude/Codex conversation history in it.

Each dispatch starts an isolated persistent **Codex CLI** session through
`codex exec` in a detached Git worktree. It cannot create or control a Codex
Desktop chat window. Task cards, reports, patches, and verification evidence are
the shared handoff between tools.

## Codex usage notes

This skill is a coordinator role, not a permission boundary. In Codex, tool access
is governed by the session sandbox and approval settings, not by skill frontmatter.
The original Claude `allowed-tools` list is preserved here only as intent: this
skill expects to read/search files, edit task cards and `PROJECT_STATE.md`, inspect
git status/diff, run `npm run test:run` and `npm run build`, and run the four
dispatch/integrate/cleanup scripts under `${AGENTS_SKILL_DIR}/scripts/`. Keep the
coordinator constraint (do not implement product code yourself) as prompt guidance.

Invoke this skill explicitly with the feature or task text as its argument; it is
not meant to be auto-selected for unrelated requests.
