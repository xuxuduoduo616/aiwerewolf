# Memory Contract — 读取、写入、所有权与冲突规则

适用于所有在本仓库工作的 Agent（Claude Code、Codex worker、Antigravity）。

## 读取

- 开工前按 [INDEX](INDEX.md) 的阅读顺序读取；不要依赖私有会话记忆推断项目状态。
- 历史 `reports/`、`runs/` 是证据归档；当前状态只以
  `coordination/PROJECT_STATE.md` 为准。
- 所有链接使用仓库相对路径；canonical 记忆中禁止绝对路径（`/Users/...`）。

## 写入所有权（唯一写入者）

| 角色 | 允许写 | 禁止写 |
|---|---|---|
| coordinator（Claude Code 主会话） | PROJECT_STATE、progress-report(ROADMAP)、WORKFLOW、INDEX、decisions/、任务卡 Status→Accepted | — |
| planner | `tasks/<id>.md`（新卡）、planning report | PROJECT_STATE、progress-report、已有卡 |
| coder | 自己的 `reports/<id>.md`、所领卡的 Status（≤Ready for review）、handoffs/ delta | PROJECT_STATE、progress-report、他人卡/报告 |
| debugger | `reports/<id>-review.md`（含 VERDICT）、handoffs/ delta | 产品代码、PROJECT_STATE、任务卡 |
| 角色不明的 Agent | handoffs/ pending delta | 一切 canonical 文件 |

Codex worktree 中的 worker 永不直接改共享状态：只返回 report 路径与 delta，
由 coordinator 集成后统一写回。

## 写回事件（何时更新 canonical）

debugger PASS 且被接受；计划/范围变化；新 ADR；blocker 出现或解决；
测试基线变化；部署/回滚/线上配置验证完成；优先级或下一步变化。

## Delta 格式（handoffs/ 中的 pending delta）

```
Metadata: timestamp / agent / role / task_id / base_commit / evidence_paths
Changed: 已验证发生了什么
Decisions: 新确认的决定及理由
Evidence: test/build/browser/deploy/report 证据
Blockers: 新增或解决
Next: 下一项可执行工作
Canonical targets: 每项应更新到哪个唯一事实源
```

- delta 必须记录 `base_commit`；若 canonical 在读取后已变化，不得覆盖——
  标记 conflict 交 coordinator 合并。
- 已存在于 canonical 的事实不得重复写入；先搜索再追加。

## 禁止写入共享记忆

原始聊天/transcript、未确认的想法、长篇推理、API key/token/env 值/
Authorization header、与 canonical 重复的事实副本、无证据的"已完成"结论。
对话内容只有被确认为决定、计划、任务或事实后才可写入。

## 入口文件（薄 Adapter）

`CLAUDE.md`（Claude Code）与 `AGENTS.md`（Codex/Antigravity）只包含：
本端身份与限制、INDEX 链接、最小 must-read 集、write-back 指令、no-secrets
规则。项目状态、架构、roadmap 正文只在 canonical 文件中。
