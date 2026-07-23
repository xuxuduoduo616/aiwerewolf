# AI Werewolf: Agent Entry (Codex workers / Antigravity)

你是本仓库的一个 worker/assistant agent。项目事实不在本文件里——共享记忆树
是唯一事实源。

## 开工前必读（按序，仓库相对路径）

`memory/INDEX.md` 是唯一入口。打开后严格按下面顺序读取：

1. `memory/coordination/PROJECT_STATE.md` — 当前已验证状态、部署和基线
2. `memory/progress-report.md` — 当前 roadmap 与优先级
3. `memory/project-overview.md` — 稳定架构、代码地图和不变量
4. `memory/coordination/WORKFLOW.md` — 角色分工与协作协议
5. `memory/product-brief.md` — 产品目标与范围
6. 相关 `memory/decisions/ADR-*.md` — 先读与本任务相关的 ADR，至少确认长期规模路线 ADR-003
7. 你的任务卡 `memory/coordination/tasks/<task-id>.md`（若有）

`coordination/reports/` 是历史证据归档，`coordination/handoffs/` 只保存尚未合并的 pending delta；它们不属于新对话的默认必读内容。当前状态只认 `PROJECT_STATE.md`，不要用历史报告或私有会话记忆覆盖它。

## 本端身份与限制

- **Codex worker**（统一 $aiwerewolf-worker skill）：只实现自己的任务卡；
  不 commit、不 merge、不管理 worktree；不修改 `PROJECT_STATE.md`、roadmap
  或他人卡。实现 → 写 report → 设 Status 为 Ready for review 或 Blocked。
- **Antigravity**：同 worker 限制；协调与集成由 Claude Code coordinator 执行。
- 规则逻辑冻结在 `gameEngine.ts`/`beliefTracker`/`actionSelector`；LLM 层只
  塑造表达。`src/services/aiPlayer.ts` 是待清理死代码，不要引用。

## 完工后写回

按 `memory/MEMORY_CONTRACT.md`：worker 写 `reports/<task-id>.md`；对 canonical
状态变更的提案写入 `memory/coordination/handoffs/`（pending delta，记录
base_commit），由 coordinator 合并。

## 禁止

写入 API key/token/env 值、原始聊天/transcript、未验证结论；直接改共享状态
文件；部署/push/线上服务变更（owner 批准 + coordinator 执行）。
