# AI Werewolf ROADMAP 与剩余工作

**Canonical owner:** coordinator。当前已验证状态见
[coordination/PROJECT_STATE.md](coordination/PROJECT_STATE.md)（本文件不记录状态）。

## 下一批优先任务

1. **P1 speech-placeholder-resolution** — 语料清洗残留的英文占位符
   （"that player"/"the other player"）在显示层原样出现；需在选词时解析为
   实际座位号（N号）或改用中文占位词。证据：
   `coordination/reports/browser-verification-tts-vote/README.md`。
2. **P1 zh-display-language-purity** — zh 显示模式下 fallback 发言以英文为主；
   核对 lobby-language-authority 预期与清洗后语料语言分布。
3. **P2 katakana-entity-follow-up** — 5 个片假名人名（リサ/ケン/カイ/ミナ/サトル）
   不在 aiwolf-entities.json，~300 处引用逃过清洗（roster-fix debugger 发现）。
   扩充实体表后重跑 sanitize 脚本。
4. **P2 cloud-tts-implementation** — 按 spike 报告草案卡实施 gemini-2.5-flash-preview-tts
   Netlify Function 适配层（`coordination/reports/cloud-tts-adapter-spike.md`）。
5. **P3 visibleText-dead-code-cleanup** — useGameState 中未被消费的导出
   （browser-tts-mvp 评审发现）。

## 待办队列（已排卡未执行）

`coordination/tasks/` 中 Status=Queued 的卡：p0-fix-guest-lobby-deadlock、
p0-wolf-teammate-visual、p1-final-screen-polish、p1-ui-design-system、
p1-ui-screen-polish、p1-vote-summary-redesign、p2-model-adapter。
（部分可能已被后续修复覆盖，执行前需 planner 去重复核。）

## 已知缺口（非阻塞）

- 浏览器 E2E 未覆盖全部角色/板型（12 人局、狼队徽章路径）。
- AIWolf 原始数据下载/蒸馏 — license 待 owner/法务决定。
- vibecoder.store 集成 — 网络不可达，待重试。
- AICODEMIRROR_API_KEY / DEEPSEEK_API_KEY 未配置 — provider-adapter 仅走
  gemini/local 链。
- 音效系统仅有 TTS 与投票 tick；无环境音/事件音（可选增强）。

## 人工核验清单（须 owner 或线上操作）

1. Supabase RLS 策略、邮件模板 `{{ .Token }}`、真实 OTP 闭环。
2. Netlify 环境变量与 `ALLOWED_ORIGIN`。
3. 完整真人对局验收：12 人局、每个特殊身份、断网回退。
