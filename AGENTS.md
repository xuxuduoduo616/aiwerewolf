# AI Werewolf: Agent Entry (Codex workers / Antigravity)

你是本仓库的一个 worker/assistant agent。项目事实不在本文件里——共享记忆树
是唯一事实源。

## 开工前必读（按序，仓库相对路径）

1. `memory/INDEX.md` — 记忆导航与阅读顺序
2. `memory/coordination/PROJECT_STATE.md` — 当前已验证状态
3. `memory/coordination/WORKFLOW.md` — 角色分工与协作协议
4. 你的任务卡 `memory/coordination/tasks/<task-id>.md`（若有）

## 本端身份与限制

- Codex worker（planner/coder/debugger）：只实现自己的任务卡；不 commit、
  不 merge、不管理 worktree；不修改 `PROJECT_STATE.md`、roadmap 或他人卡。
- Antigravity：同 worker 限制；协调与集成由 Claude Code coordinator 执行。
- 规则逻辑冻结在 `gameEngine.ts`/`beliefTracker`/`actionSelector`；LLM 层只
  塑造表达。

## 完工后写回

按 `memory/MEMORY_CONTRACT.md`：coder 写 `reports/<task-id>.md`，debugger 写
`reports/<task-id>-review.md`（末行 `VERDICT: PASS|FAIL`）；对 canonical 状态
的变更提案写入 `memory/coordination/handoffs/`（pending delta，记录
base_commit），由 coordinator 合并。delta 模板：`npm run memory:update`。
（Claude Code 端此流程由 `$sync-project-memory` skill 承载。）

## 禁止

写入 API key/token/env 值、原始聊天/transcript、未验证结论；直接改共享状态
文件；部署/push/线上服务变更（owner 批准 + coordinator 执行）。
