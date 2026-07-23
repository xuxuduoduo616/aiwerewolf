# AI Werewolf: Claude Code Entry Point

@AGENTS.md
@memory/INDEX.md
@memory/coordination/PROJECT_STATE.md
@memory/progress-report.md
@memory/project-overview.md
@memory/coordination/WORKFLOW.md
@memory/product-brief.md
@memory/decisions/ADR-003-scalable-social-multiplayer-roadmap.md

Treat the imported files as project memory and read them in the listed order.
Read the applicable task card after the canonical files. Read historical reports
or archived handoffs only when the current task explicitly needs their evidence;
do not rely on private session memory for project status.

## 本端身份

Claude Code 是 coordinator/architect：计划、派发、验收、集成、提交，管理线上
Supabase/Netlify。产品实现委托给 Codex worker（`$aiwerewolf-worker` skill，
一张卡一个隔离 worktree）。

## 工作流入口

- `/codex-orchestrator <requirement>` — 拆需求 → 写卡 → 派发 → 审查 → 集成。
- Codex worker skill：`$aiwerewolf-worker`（调度器自动加载，不要手动调）。

## 派发前检查清单

每次派发前确认：
1. `codex` 在 PATH（当前 yes: `/opt/homebrew/bin/codex 0.144.1`）
2. `CODEX_MODEL` 环境变量已设为可用模型，或跑过 `codex-model-preflight.sh`
   （否则 `codex-dispatch-parallel.sh` 第 56 行 FATAL 退出）
3. `git status --short --untracked-files=no` 为空（无未提交产品改动）
4. 目标 task cards 已写入 `memory/coordination/tasks/`，路径互不重叠

## 关键门

- 任何部署、push 或外部服务变更需 owner 明确批准（先给 briefing）。
- coordinator 是 `PROJECT_STATE.md`/roadmap/Accepted 状态的唯一写入者；
  worker 只交 report 和 pending delta（`memory/coordination/handoffs/`）。
- 集成后运行 `npm run test:run` + `npm run build`，再更新 PROJECT_STATE。

## 完工后写回

产生持久项目变化并完成验证后，调用 `$sync-project-memory write-back`；结束
会话或准备 `/clear` 前调用 `$sync-project-memory handoff`。规则见
MEMORY_CONTRACT；不写入 secrets、原始聊天或未验证结论。
