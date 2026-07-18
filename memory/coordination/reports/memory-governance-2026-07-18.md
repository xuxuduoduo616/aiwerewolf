# 跨 Agent 共享记忆治理 — 最终报告 (2026-07-18)

## 1. 原始记忆地图主要发现（三端并行审计）

- AGENTS.md 是 CLAUDE.md 的 symlink 且第 3 行自引用 `@AGENTS.md`（循环）。
- project-overview/progress-report 携带 2026-07-11 过期状态（"14/14 tests"，
  实际 363），且被注入每个 Claude 会话与每个 Codex worktree。
- 工作流规则（10-worker 上限、PASS 门、部署审批）在 4+ 处重复。
- `.agents/` orchestrator skill 是过期 fork（max 3 workers vs canonical 10）。
- 部署状态双写：用户级 ~/.claude 记忆 + PROJECT_STATE，且互相领先/落后。
- Antigravity 无独立记忆面：只发现 `.agents/` + AGENTS.md；@-import 对它是纯文本。
- 5 张已集成卡的 Status 仍为 Ready for review（状态矛盾）。

## 2. 新共享记忆树

见 `memory/INDEX.md`（唯一导航 + owner 表）与 `memory/MEMORY_CONTRACT.md`
（所有权矩阵、写回事件、delta 格式、冲突规则、禁写清单）。新增
`memory/decisions/`（ADR-001）与 `memory/coordination/handoffs/`（pending delta）。

## 3. 旧文件处置

| 文件 | 决定 |
|---|---|
| memory/MEMORY.md | git mv → INDEX.md（保留历史） |
| memory/progress-report.md | 重写为 ROADMAP；路径保留（全局 Codex planner skill 硬编码） |
| memory/project-overview.md | 剥离状态段，保留架构（路径保留） |
| memory/coordination/PROJECT_STATE.md | 刷新至 round-7 真实状态；仍为唯一状态文件 |
| CLAUDE.md | 重写为 28 行薄入口（coordinator 身份 + 3 个 @-import + 关键门） |
| AGENTS.md | 断开 symlink → 31 行真实文件，纯文本路径（Codex/Antigravity 入口） |
| .agents/skills/codex-orchestrator | 先入库（回滚基线 fd71bd7）再同步至 canonical，加 Mirror 头注 |
| 41 张任务卡 + 94 报告 + runs/ | 保留为历史证据；INDEX 明示"不代表当前状态" |
| ~/.claude/.../netlify-deploy-blocked.md | 瘦身为指针（canonical 在仓库 PROJECT_STATE） |

## 4. 三端读取入口

- Claude Code: CLAUDE.md（@-import INDEX/PROJECT_STATE/WORKFLOW 自动加载）。
- Codex worker: AGENTS.md 纯文本 must-read 列表（worktree 由 dispatcher 复制
  同一组文件，路径未变，脚本零改动）。
- Antigravity: AGENTS.md + .agents/（skill 已同步）。

## 5. 写回协议与所有权

MEMORY_CONTRACT.md：coordinator 唯一写 PROJECT_STATE/ROADMAP/Accepted；
coder/debugger 只写自己 report；其他角色只提交 handoffs/ pending delta
（必含 base_commit；canonical 已变则标记 conflict 不覆盖）。

## 6. 三端 fresh-agent 理解测试

三个零上下文 agent 各自只从原生入口链读取，回答同一组 10 问：
**10/10 关键事实三方一致**（产品、阶段、优先任务、角色、文件所有权、批准门、
测试基线 363/5、写回、冲突避免、禁止项），引用文件一致。
说明：Codex/Antigravity 测试为入口视角模拟（Claude 子代理按各端文件发现规则
执行）——gpt-5.6 预检不可达、Antigravity 无 headless 模式；模拟忠实于两端的
真实读取能力（无 @-import 展开）。

Fixture forward test：模拟 coder delta（fixture-card Accepted、基线 999、新
blocker）→ coordinator 按协议合并 → 全新 agent 从 AGENTS.md 入口 3/3 读回
fixture 状态 → git checkout + 删除 fixture 完全恢复，validate/audit 复归 PASS。

## 7. 验证命令

`npm run memory:validate` PASS（入口可达/canonical 齐全/无自引用/状态唯一/无断链）；
`npm run memory:audit` PASS（无重复状态事实/无 secrets/无失效链接/规则单源）；
`npm run memory:status` 正常；`npm run test:run` 363 passed；`npm run build` 成功。

## 8. 无法自动同步的能力（如实声明）

三个产品的私有聊天不能实时同步。本方案实现的是：项目内 canonical memory +
任务结束写回 + 新任务启动读取的**文件级最终一致记忆**。Antigravity 若离线
使用旧 clone，仍可能读到旧树（Git 拉取是同步边界）。`.agents/` skill 镜像
需在 canonical 变更时手动重同步（已加 Mirror 头注提示）。

## 9. 风险、回滚与待 owner 批准项

- 回滚：全部迁移在 git 提交内（基线 fd71bd7 → 迁移 eb2a6de+），`git revert` 即可。
- 待批准的全局配置问题（本轮未动，仅报告）：
  1. `~/.claude/projects/.../aicodemirror-codex-api-key.md` 存有明文 API key；
  2. 项目 `.claude/settings.local.json` allowlist 含 Resend key + 2 个 Supabase JWT
     明文（建议轮换并清理）；
  3. `~/.codex/skills/aiwerewolf-*` 4 个全局角色 skill 各自重复"repo 单一事实源"
     规则——可在未来指向 MEMORY_CONTRACT（需批准修改全局 skill）。
- Phase B（sync-project-memory skill）按 owner 指示单独下达，本轮未创建。
