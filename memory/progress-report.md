# AI Werewolf ROADMAP 与剩余工作

**Canonical owner:** coordinator。当前已验证状态见
[coordination/PROJECT_STATE.md](coordination/PROJECT_STATE.md)（本文件不记录状态）。

**更新日期:** 2026-07-24（Stage 0 production release + TC-001 governance checkpoint）

## 当前派发状态

`coordination/tasks/` 中没有可直接派发的 active card；其中卡片是保留用于
追溯的历史记录：已完成卡标记为 `Accepted`，被后续实现取代的旧卡标记为
`Superseded`。当前 owner-approved coordinator 工作在独立 invocation artifacts
中跟踪，只有通过验收并集成的事实才写回本 roadmap。

## 待重新规划（不是现成任务卡）

| # | Task ID | 优先级 | 说明 |
|---|---------|--------|------|
| 1 | `speech-placeholder-resolution` | P1 | "that player" 等占位符在显示层原样出现，需解析为 N 号 |
| 2 | `zh-display-language-purity` | P1 | zh 模式 fallback 发言以 EN 为主 |
| 3 | `katakana-entity-follow-up` | P2 | 5 个片假名人名未入实体表，~300 处引用逃过清洗 |
| 4 | `cloud-tts-implementation` | P2 | gemini-2.5-flash-preview-tts Netlify 适配层 |
| 5 | `visibleText-dead-code-cleanup` | P3 | useGameState 中未被消费的导出 |

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
- `provider-adapter.cjs` 多模型路由源码存在；生产 endpoint 状态未验证
- ✅ Cloudflare Turnstile 集成完毕
- ✅ 移动端 UI 壳完工（GlobalShell, BottomNav, TopStatusBar, etc.）
- ✅ 玩家充值系统接入完成（CoinStore → useWallet → payment-escrow → Supabase coin_orders + user_coins，游客+注册用户双路径已验证 live）

## 已知缺口（非阻塞）

- 浏览器 E2E 未覆盖全部角色/板型（12 人局、狼队徽章路径）。
- AIWolf 原始数据下载/蒸馏 — license 待 owner/法务决定。
- vibecoder.store 集成 — 网络不可达，待重试。
- AICODEMIRROR_API_KEY / DEEPSEEK_API_KEY 的当前配置状态未验证。**GPT/Claude/DeepSeek/Doubao 多模型 per-player 接入仍需 owner 选择平台并提供相应商户/API 配置。**
- 音效系统仅有 TTS 与投票 tick；无环境音/事件音（可选增强）。
- Netlify CLI 当前认证状态未验证。Netlify Git integration 已从 `main` 发布精确 commit；GitHub Actions workflow 因未注入必需 Turnstile build input 而失败，尚不是已验证发布路径。

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
