# aiwerewolf 共享记忆索引（唯一导航入口）

这是 Codex、Claude Code 与 Antigravity 共享的、随 Git 提交的项目记忆树。
它记录项目事实、决策和任务交接；不记录私有会话内容、密钥或完整终端日志。
读写规则见 [MEMORY_CONTRACT](MEMORY_CONTRACT.md)。

## 阅读顺序（开工前）

1. [coordination/PROJECT_STATE](coordination/PROJECT_STATE.md) — **当前状态**：
   已验证基线、部署状态、阶段判断。当前状态只在这一个文件里。
2. [progress-report](progress-report.md) — ROADMAP：剩余计划、优先级、已知缺口。
3. [project-overview](project-overview.md) — 架构、代码地图、关键不变量（稳定事实）。
4. [coordination/WORKFLOW](coordination/WORKFLOW.md) — 角色分工与协作协议。
5. [product-brief](product-brief.md) — 产品目标与首阶段需求（稳定事实）。

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

历史 reports/runs 是证据归档，**不代表当前状态**；当前状态一律以
PROJECT_STATE 为准。

## 校验

`npm run memory:validate` 检查入口可达、canonical 文件存在、无递归引用；
`npm run memory:audit` 检查重复事实、矛盾状态、失效链接。
