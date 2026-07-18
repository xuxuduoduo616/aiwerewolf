---
name: sync-project-memory
description: "Write verified, deduplicated project deltas into the aiwerewolf shared memory tree (memory/INDEX.md system). Invoke after a debugger PASS is accepted; after a commit, deploy, rollback, or external-config verification; when product scope, roadmap, architecture, or a formal decision changes; when a blocker appears or resolves; when the test/build baseline changes; before a handoff, session end, or /clear; or when the user asks to save memory or sync progress. Not a chat archiver — checkpoint write-back + next-session read-back only."
argument-hint: "[write-back|handoff|audit|status|validate]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git status *), Bash(git log *), Bash(git rev-parse *), Bash(git diff *), Bash(npm run memory:*), Bash(node scripts/memory-tools.mjs *)
---

# sync-project-memory — 检查点式共享记忆写回

文字权威在 canonical memory；本 skill 只做「验证过的增量 → 唯一事实源」。
不归档聊天，不虚构事实，不实现实时跨端同步（文件级最终一致）。

## 每次运行必先读

1. `memory/INDEX.md`（owner 表 + 阅读顺序）
2. `memory/MEMORY_CONTRACT.md`（所有权矩阵、delta 格式、禁写清单——本 skill 的宪法）
3. `memory/coordination/PROJECT_STATE.md` + `memory/progress-report.md`（现状与 roadmap）
4. 相关任务卡与 coder/debugger report（若有）
5. `git status` + `git rev-parse --short HEAD`（作 base_commit）

## 子命令（无参数 = write-back）

### write-back
1. **识别角色**：coordinator（主会话）/ coder / debugger / 不确定。
2. **生成 delta**：`npm run memory:update` 打印模板；只填**已验证**的事实
   （测试/构建/浏览器/部署证据必须真实存在，路径可引用）。
3. **去重**：Grep canonical 文件——已存在的事实不重写；事实变化则更新其
   canonical owner 文件（owner 表见 INDEX），绝不在第二处复制。
4. **按角色写入**：
   - coordinator → 直接更新 canonical（PROJECT_STATE / progress-report /
     WORKFLOW / decisions/ADR-*）；
   - coder/debugger/不确定 → 只写
     `memory/coordination/handoffs/<UTC>-<agent>.md`（pending delta，含
     base_commit），**不碰 canonical**。
5. **冲突检查**：写前若 canonical 的 HEAD 已不同于读取时的 base_commit，
   标记 delta 为 conflict 交 coordinator，不覆盖。
6. **收尾**：`npm run memory:validate` 必须 PASS。

### handoff
write-back 全流程 + 在 delta 的 Next 字段写明「下一位 Agent 从哪张卡/哪一步
继续」。用于会话结束或 `/clear` 前。

### audit / status / validate
直接运行 `npm run memory:audit` / `memory:status` / `memory:validate`，
原样报告输出；只报告问题，不擅自修改记忆。

## 禁止（违反即中止写入）

原始聊天/transcript、未确认想法、长篇推理、API key/token/env 值/
Authorization header、canonical 已有事实的副本、无证据的「已完成」。
输入含疑似密钥（sk-/AIza/re_/eyJ…）→ 拒绝写入并脱敏提示。
纯 brainstorm 只有被确认为「决定/计划/任务」后才可写。

## 频率纪律

不在每条消息后运行；只有未验证代码改动时不更新 canonical state。
一个检查点一次 write-back。
