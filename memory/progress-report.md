# AI Werewolf ROADMAP 与剩余工作

**Canonical owner:** coordinator。当前已验证状态见
[coordination/PROJECT_STATE.md](coordination/PROJECT_STATE.md)（本文件不记录状态）。

**更新日期:** 2026-07-23（payment system verified live）

## 当前派发状态

当前没有可以直接派发的 active task card。`coordination/tasks/` 中的历史卡片
保留用于追溯：已完成卡标记为 `Accepted`，被后续实现取代的旧卡标记为
`Superseded`。新的需求必须由 coordinator 重新核对当前状态、创建新任务卡，
并在卡片中引用相关 ADR。

## 待重新规划（不是现成任务卡）

| # | Task ID | 优先级 | 允许范围 | 说明 |
|---|---------|--------|---------|------|
| 1 | `legacy-ai-player-cleanup` | P1 | `src/services/aiPlayer.ts` 仅删除 | 死代码，无任何导入，15KB。删除后跑 test:run + build 确认 |
| 2 | `type-safety-cleanup` | P1 | `src/hooks/useAuth.ts`（4 处 any）+ `src/ai/aiOrchestrator.ts`（1 处 as any） | 收紧为领域类型，不改行为 |
| 3 | `seo-robots` | P2 | `index.html` meta 标签 + 新增 `public/robots.txt` | 纯增量，无现有代码修改 |

## 后续波次

| # | Task ID | 优先级 | 说明 |
|---|---------|--------|------|
| 4 | `netlify-csp` | P1 | `netlify.toml` CSP header。需部署验证 → 单独走 |
| 5 | `speech-placeholder-resolution` | P1 | "that player" 等占位符在显示层原样出现，需解析为 N 号 |
| 6 | `zh-display-language-purity` | P1 | zh 模式 fallback 发言以 EN 为主 |
| 7 | `katakana-entity-follow-up` | P2 | 5 个片假名人名未入实体表，~300 处引用逃过清洗 |
| 8 | `cloud-tts-implementation` | P2 | gemini-2.5-flash-preview-tts Netlify 适配层 |
| 9 | `visibleText-dead-code-cleanup` | P3 | useGameState 中未被消费的导出 |

## 已完成（2026-07-07 ～ 2026-07-22 打磨期）

- ✅ 预言家查验结果在被验者头顶显示"金水"/"查杀"标记（仅预言家可见）
- ✅ 真人玩家死后不再可发言（遗言后自动跳过）
- ✅ AI 发言中英混杂修复：`isChinese()` 三层检测（Gemini→发言库→fallback 全程优先中文）
- ✅ 女巫可看刀口：控制台显示"昨夜X号被狼人袭击"
- ✅ 30天免登录：localStorage 持久化 session token
- ✅ 暗牌场：夜间死亡/毒死/枪死不展露角色身份
- ✅ 登录验证码过期bug修复：`getClient()` 不再缓存 Supabase 客户端
- ✅ SSL 证书修复：Resend SMTP + Let's Encrypt + Cloudflare DNS 切换
- ✅ 重定向循环修复：移除 Cloudflare 重复 redirect 规则
- ✅ `provider-adapter.js` 多模型路由层已部署（支持 gemini/anthropic-messages/openai-chat 协议）
- ✅ Cloudflare Turnstile 集成完毕
- ✅ 移动端 UI 壳完工（GlobalShell, BottomNav, TopStatusBar, etc.）
- ✅ 玩家充值系统接入完成（CoinStore → useWallet → payment-escrow → Supabase coin_orders + user_coins，游客+注册用户双路径已验证 live）

## 已知缺口（非阻塞）

- 浏览器 E2E 未覆盖全部角色/板型（12 人局、狼队徽章路径）。
- AIWolf 原始数据下载/蒸馏 — license 待 owner/法务决定。
- vibecoder.store 集成 — 网络不可达，待重试。
- AICODEMIRROR_API_KEY / DEEPSEEK_API_KEY 未配置 — provider-adapter 仅走 gemini/local 链。**GPT/Claude/DeepSeek/Doubao 多模型 per-player 接入待 owner 提供各平台 API key。**
- 音效系统仅有 TTS 与投票 tick；无环境音/事件音（可选增强）。
- Netlify CLI 部署 token 过期需 owner 重登（`netlify login`），GitHub auto-deploy 未开启。

## 人工核验清单（owner 或线上操作）

1. Supabase RLS 策略、邮件 OTP 闭环 ✅（已验证 2026-07-07 — Resend SMTP 正常工作）
2. Netlify 环境变量与 `ALLOWED_ORIGIN` ✅
3. 完整真人对局验收：12 人局、每个特殊身份、断网回退（待 owner 试玩）
4. 多模型 API key 收集：GPT-5.6/5.5、DeepSeek v4-pro、Doubao、Claude、NotebookLLM

## 历史任务卡

以下历史卡已被后续实现覆盖并关闭，不得直接重新派发：

`p0-fix-guest-lobby-deadlock`、`p0-wolf-teammate-visual`、
`p1-final-screen-polish`、`p1-ui-design-system`、`p1-ui-screen-polish`、
`p1-vote-summary-redesign`、`p2-model-adapter`。

## 历史说明

旧 task cards、reports 和 handoffs 是历史证据，不代表当前 roadmap 或当前
部署状态。新增任务以 `PROJECT_STATE.md`、本文件和相关 ADR 为准。
