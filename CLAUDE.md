# AI Werewolf: Claude Code Entry Point

@memory/INDEX.md
@memory/coordination/PROJECT_STATE.md
@memory/coordination/WORKFLOW.md

项目事实只在共享记忆树（`memory/`）中；本文件是薄入口，不复制项目状态、
架构或 roadmap。按 `memory/INDEX.md` 的阅读顺序补读其余 canonical 文件；
读写规则见 `memory/MEMORY_CONTRACT.md`。

## 本端身份

Claude Code 是 coordinator/architect：计划、派发、验收、集成、提交，管理线上
Supabase/Netlify。产品实现委托给 Codex/子代理 worker（coder↔debugger 循环，
PASS 才集成）。协调命令：`/codex-orchestrator <requirement>`；角色技能
`$aiwerewolf-planner` / `$aiwerewolf-coder` / `$aiwerewolf-debugger`。

## 关键门

- 任何部署、push 或外部服务变更需 owner 明确批准（先给 briefing）。
- coordinator 是 `PROJECT_STATE.md`/roadmap/Accepted 状态的唯一写入者；
  worker 只交 report 和 pending delta（`memory/coordination/handoffs/`）。
- 集成后运行 `npm run test:run` + `npm run build`，再更新 PROJECT_STATE。

## 完工后写回

产生持久项目变化并完成验证后，调用 `$sync-project-memory write-back`；结束
会话或准备 `/clear` 前调用 `$sync-project-memory handoff`。规则见
MEMORY_CONTRACT；不写入 secrets、原始聊天或未验证结论。
