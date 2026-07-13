# aiwerewolf 记忆库

这是 Claude Code 与 Codex 共享的、可提交到 Git 的项目记忆。它记录项目事实、
决策和任务交接，不记录私有会话内容、密钥或完整终端日志。

## 阅读顺序

1. [coordination/PROJECT_STATE](coordination/PROJECT_STATE.md) — 当前验证状态、
   阶段判断、待决事项和任务队列。
2. [project-overview](project-overview.md) — 产品范围、架构、代码地图和约束。
3. [progress-report](progress-report.md) — 已验证结果、近期变更、已知缺口和建议顺序。
4. [product-brief](product-brief.md) — 原始产品目标、首阶段需求和数据模型。

任务执行时还必须阅读 `coordination/tasks/<task-id>.md`；完成后由 Codex 写入
`coordination/reports/<task-id>.md`，再由 Claude Code 验收。
