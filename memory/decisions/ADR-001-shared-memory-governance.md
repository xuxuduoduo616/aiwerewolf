# ADR-001: 跨 Agent 共享记忆治理

**日期:** 2026-07-18 · **状态:** Accepted · **决策者:** coordinator（owner 授权）

## 背景

三端（Claude Code、Codex、Antigravity）审计发现：AGENTS.md 是 CLAUDE.md 的
symlink 且自引用 `@AGENTS.md`；project-overview/progress-report 携带 2026-07-11
的过期状态（"14/14 tests"）却被注入每个会话与 worktree；工作流规则在 4+ 处
重复（CLAUDE.md、WORKFLOW.md、两份 SKILL.md）；`.agents/` 的 coordinator skill
是过期 fork（max 3 workers vs canonical 10）；部署状态在用户级记忆与
PROJECT_STATE 双写。

## 决定

1. `memory/` 为唯一事实源；新增 `INDEX.md`（导航）+ `MEMORY_CONTRACT.md`
   （所有权/delta/冲突规则）。
2. 每项事实一个 canonical owner（见 INDEX 表）；当前状态只在 PROJECT_STATE。
3. `progress-report.md` 重写为 ROADMAP（保留文件名——全局 Codex planner skill
   与 dispatcher 脚本硬编码该路径，避免全局配置变更）。
4. `project-overview.md` 只保留稳定架构事实，状态段改为指针。
5. CLAUDE.md/AGENTS.md 改为薄入口：断开 symlink，AGENTS.md 用纯文本路径
   （@-import 是 Claude 专有语法，Codex/Antigravity 视为普通文本）。
6. 非 coordinator 角色通过 `coordination/handoffs/` 提交 pending delta
   （含 base_commit），coordinator 合并。
7. `.agents/` skill fork 一次性同步至 canonical 内容（先入库保证可回滚）。

## 后果

- 三端读同一棵树；41 张历史卡的 Required-reading 路径全部继续有效（零改名）。
- 历史 reports/runs 保留为证据，INDEX 明示"不代表当前状态"。
- 全局配置（~/.codex/skills、~/.claude 设置）零改动；发现的 secrets 问题
  单独报 owner。
- 后续 `sync-project-memory` skill（Phase B，owner 另行下达）直接挂接
  MEMORY_CONTRACT 的 delta 协议，无需二次改约。
