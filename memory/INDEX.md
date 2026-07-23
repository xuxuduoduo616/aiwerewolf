# aiwerewolf 共享记忆索引（唯一导航入口）

这是 Codex、Claude Code 与 Antigravity 共享的、随 Git 提交的项目记忆树。
它记录项目事实、决策和任务交接；不记录私有会话内容、密钥或完整终端日志。
读写规则见 [MEMORY_CONTRACT](MEMORY_CONTRACT.md)。

## 阅读顺序（开工前）

入口文件 `AGENTS.md` / `CLAUDE.md` 先提供角色限制；打开本文件后，所有
Codex、Claude Code 和 Antigravity 会话按以下顺序读取：

1. [coordination/PROJECT_STATE](coordination/PROJECT_STATE.md) — **当前状态**：已验证基线、部署状态和当前产品阶段。当前状态只在这一个文件里。
2. [progress-report](progress-report.md) — ROADMAP：剩余计划、优先级和已知缺口。
3. [project-overview](project-overview.md) — 稳定架构、代码地图和关键不变量。
4. [coordination/WORKFLOW](coordination/WORKFLOW.md) — 角色分工与协作协议。
5. [product-brief](product-brief.md) — 产品目标与范围。
6. [decisions/ADR-003-scalable-social-multiplayer-roadmap](decisions/ADR-003-scalable-social-multiplayer-roadmap.md) 及与任务相关的其他 ADR — 长期路线和已确认决策。
7. `coordination/tasks/<task-id>.md` — 仅在任务已分配时读取对应任务卡。

历史 `coordination/reports/` 不属于默认必读内容；`coordination/handoffs/`
只保存尚未合并的 pending delta。新会话不得用历史报告、handoff 或私有
上下文替代 `PROJECT_STATE.md`。

执行任务时还必须阅读 `coordination/tasks/<task-id>.md`。

## 目录职责（每项事实只有一个 canonical owner）

| 内容 | Canonical 文件 | 写入者 |
|---|---|---|
| 产品目标 | [product-brief](product-brief.md) | coordinator |
| 架构与不变量 | [project-overview](project-overview.md) | coordinator |
| 当前状态/测试基线/部署 | [coordination/PROJECT_STATE](coordination/PROJECT_STATE.md) | coordinator（唯一） |
| 剩余计划/优先级 (ROADMAP) | [progress-report](progress-report.md) | coordinator |
| 工作协议/角色 | [coordination/WORKFLOW](coordination/WORKFLOW.md) | coordinator |
| 任务卡 | `coordination/tasks/<id>.md` | planner 创建，coder 更新 Status |
| 实现/评审证据 | `coordination/reports/<id>[-review].md` | coder / debugger |
| 关键决策 (ADR) | `decisions/ADR-*.md` | coordinator |
| 待合并增量 | `coordination/handoffs/*.md` | 任何 agent（pending delta） |
| 运行日志 | `coordination/runs/` | 调度脚本 |

历史 reports/runs 是证据归档，handoffs 在合并后应移入 reports，**不代表当前状态**；当前状态一律以
PROJECT_STATE 为准。

## 校验

`npm run memory:validate` 检查入口可达、canonical 文件存在、无递归引用；
`npm run memory:audit` 检查重复事实、矛盾状态、失效链接。
