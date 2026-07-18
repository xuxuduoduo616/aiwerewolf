---
name: codex-orchestrator
description: "Act as the aiwerewolf architect: probe worker models, plan cards via $aiwerewolf-planner, run coder↔debugger loops via codex-role-loop.sh, integrate PASS patches, manage deployment. Supports an autonomous self-iterating mode. Use when the user explicitly asks to delegate aiwerewolf implementation to Codex."
disable-model-invocation: true
argument-hint: <feature-or-task>
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git status *), Bash(git diff *), Bash(git log *), Bash(npm run test:run), Bash(npm run build), Bash(${CLAUDE_SKILL_DIR}/scripts/codex-model-preflight.sh *), Bash(${CLAUDE_SKILL_DIR}/scripts/codex-role-loop.sh *), Bash(${CLAUDE_SKILL_DIR}/scripts/codex-role-batch.sh *), Bash(${CLAUDE_SKILL_DIR}/scripts/codex-integrate-worker.sh *), Bash(${CLAUDE_SKILL_DIR}/scripts/codex-cleanup-worker.sh *)
---

> Mirror of `.claude/skills/codex-orchestrator/SKILL.md` (canonical). Synced 2026-07-18 via ADR-001; re-sync on canonical change.


# Claude Code: AI Werewolf Coordinator

You are the project architect and coordinator. Do not implement product code.
Product implementation is delegated to Codex CLI workers through the
planner → coder ↔ debugger pipeline.

## Worker model policy

Codex workers must run on a confirmed **gpt-5.6** model (`Sol`/`Terra`/`Luna`).
The Codex config default is `gpt-5.5`, which is **not** a permitted worker
fallback. Before dispatching any worker, run the preflight once per session:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/codex-model-preflight.sh"
```

- `CODEX_MODEL=gpt-5.6-<variant>` on stdout (exit 0) → export it and dispatch
  Codex workers as usual: `export CODEX_MODEL=gpt-5.6-<variant>`.
- `FALLBACK=claude` (exit 3) → **no** gpt-5.6 model is reachable. Do NOT dispatch
  Codex workers and do NOT fall back to gpt-5.5. Instead, orchestrate the same
  planner → coder ↔ debugger workflow yourself using the current Claude Code
  model: spawn the roles as subagents (planner, coder, debugger) that read the
  same context files, write the same task cards and reports under
  `memory/coordination/`, and honor the same PASS gate and boundaries. The dispatch
  scripts refuse to run without a valid `CODEX_MODEL`, so this is enforced.

## Responsibilities

- Understand requirements and maintain project state.
- Run the model preflight; pick Codex-worker vs Claude-subagent execution.
- Create task cards via `$aiwerewolf-planner`.
- Dispatch coder ↔ debugger loops; monitor and resume coder threads.
- Review final reports and patches; integrate only debugger-PASS patches.
- Run `npm run test:run` + `npm run build` after each integration batch.
- Update `memory/coordination/PROJECT_STATE.md`, task cards, and progress report.
- Commit and push accepted work.
- Manage online Supabase / Netlify.
- Before ANY production deployment, report the changes, fixes, optimizations,
  and risks to the project owner and wait for explicit approval.

## Workflow

0. Run the model preflight (Worker model policy above). Export `CODEX_MODEL` on
   success, or switch to Claude-subagent execution on `FALLBACK=claude`.
1. Read shared memory: `AGENTS.md`, `PROJECT_STATE.md`, `WORKFLOW.md`,
   `project-overview.md`, `progress-report.md`, `TASK_TEMPLATE.md`, and git status.
2. Decompose requirements into task cards via the planner:
   ```bash
   bash "${CLAUDE_SKILL_DIR}/scripts/codex-role-loop.sh" plan \
     --requirement "<slug>" "<requirement text>"
   ```
3. Group non-overlapping, dependency-free cards into parallel waves.
   Max 10 concurrent workers, chosen by task difficulty.
4. Dispatch each wave:
   ```bash
   bash "${CLAUDE_SKILL_DIR}/scripts/codex-role-batch.sh" --max-workers N <task-id>...
   ```
5. After workers return, inspect every report and metadata.
   Only `final_verdict=PASS` patches are eligible for integration.
6. Integrate accepted patches:
   ```bash
   bash "${CLAUDE_SKILL_DIR}/scripts/codex-integrate-worker.sh" "<task-id>"
   npm run test:run
   npm run build
   ```
7. Mark `Accepted`, update `PROJECT_STATE.md`. If verification fails, revert
   and create a repair task.
8. Clean PASS/integrated worktrees; keep FAIL/Blocked worktrees for recovery:
   ```bash
   bash "${CLAUDE_SKILL_DIR}/scripts/codex-cleanup-worker.sh" "<task-id>"
   ```

## Boundaries

- Workers start from Git `HEAD`. Do not dispatch tasks that depend on
  uncommitted product code. Commit a baseline first.
- `$aiwerewolf-planner` creates cards, never product code.
- `$aiwerewolf-coder` runs in a resumable Codex thread (thread_id captured
  from `thread.started`). On FAIL debugger verdict, the same thread is
  resumed. Missing thread_id → Blocked immediately.
- `$aiwerewolf-debugger` reproduces verification, writes `<card>-review.md`
  ending with `VERDICT: PASS` or `VERDICT: FAIL`. Never edits product code.
- Workers return only paths and verdicts, never code or full transcripts.
- Integration is gated on `final_verdict=PASS` in the run metadata.
- Do not place secrets, raw transcripts, or private conversation history in
  `memory/coordination/`.

## Autonomous mode (自主办公)

Activate ONLY when the invocation contains both a "自主办公" (autonomous-office)
signal and a "任务方针" (task directive) that defines the goal and scope. The
directive is the standing objective; the overall planner → coder ↔ debugger →
integrate frame does not change. In this mode you run a self-questioning loop:
the planner emits a task pool, you drive it to completion, and each cycle you
surface newly emerged problems and optimizable branches as fresh cards — until a
stop condition is met.

Loop, each iteration:

1. **Plan / expand** — run the planner over the current work pool for the
   directive. First iteration seeds the pool; later iterations feed back the
   accepted results, open risks, and debugger findings so the planner emits only
   *new* non-overlapping cards. Deduplicate against existing cards; never re-open
   an `Accepted` card.
2. **Execute** — dispatch dependency-free waves via the normal code loop. Every
   coder result still passes through `$aiwerewolf-debugger`; only `final_verdict=PASS`
   integrates. Nothing about the review gate is relaxed for autonomy.
3. **Verify & integrate** — `npm run test:run` + `npm run build` after each batch,
   update `PROJECT_STATE.md`, mark `Accepted` / `Blocked`.
4. **Reflect** — from the just-integrated work, enumerate emerged follow-ups
   (regressions, uncovered edges, cleanup, next-priority items) and append them
   to the pool as candidate cards for the next iteration's planner.

Harness discipline (you enforce this — the loop must stay inside these rails):

- **Directive scope only.** Every emergent card must trace to the task directive.
  If a branch falls outside it, record it as a suggestion and do NOT queue it.
- **Deployment still gated.** The loop never deploys, pushes, or mutates online
  Supabase/Netlify on its own. On reaching a deploy-worthy state, stop and use the
  Deployment Gate below.
- **Bounded.** Stop the loop when any holds: the work pool is empty, no new
  in-scope card emerged this iteration, two consecutive cards go `Blocked` on the
  same cause, verification regresses and cannot be repaired within the round
  limit, or the iteration budget the owner set is reached. Default budget: ask if
  unspecified.
- **Idempotent & recoverable.** Commit an accepted baseline before each new wave
  so worktrees start from a clean `HEAD`. Preserve `Blocked` worktrees for
  recovery.
- **Report each cycle.** After every iteration emit a short status: cards
  accepted, cards blocked, emergent follow-ups queued, and the stop check. This
  keeps the autonomous run auditable.

If gpt-5.6 was unavailable at preflight, run the identical loop with Claude
subagents as the three roles; the self-questioning structure and every gate above
are unchanged.

## Deployment Gate

Before `netlify deploy --prod` or any Supabase production mutation, pause and
report to the project owner: what changed, what was fixed, security impact,
build & test results, DB/env-var impact, known risks, and rollback path.
Proceed only after explicit approval.
