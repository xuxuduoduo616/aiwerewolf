# AI Werewolf ROADMAP 与剩余工作

**Canonical owner:** coordinator。当前已验证状态见
[coordination/PROJECT_STATE.md](coordination/PROJECT_STATE.md)（本文件不记录状态）。

**更新日期:** 2026-07-19（框架初始化后校正）

## 立即可派发（并行 Wave 1 — 路径不重叠，无依赖）

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

## 已知缺口（非阻塞）

- 浏览器 E2E 未覆盖全部角色/板型（12 人局、狼队徽章路径）。
- AIWolf 原始数据下载/蒸馏 — license 待 owner/法务决定。
- vibecoder.store 集成 — 网络不可达，待重试。
- AICODEMIRROR_API_KEY / DEEPSEEK_API_KEY 未配置 — provider-adapter 仅走 gemini/local 链。
- 音效系统仅有 TTS 与投票 tick；无环境音/事件音（可选增强）。

## 人工核验清单（owner 或线上操作）

1. Supabase RLS 策略、邮件模板 `{{ .Token }}`、真实 OTP 闭环。
2. Netlify 环境变量与 `ALLOWED_ORIGIN`。
3. 完整真人对局验收：12 人局、每个特殊身份、断网回退。

## 已排卡但可能过时

`coordination/tasks/` 中部分 Status=Queued 的卡（p0-fix-guest-lobby-deadlock、
p0-wolf-teammate-visual、p1-final-screen-polish、p1-ui-design-system、
p1-ui-screen-polish、p1-vote-summary-redesign、p2-model-adapter）可能已被
后续修复覆盖。执行前 planner 需去重复核。

## 待办池 (2026-07-19 剩余未结束任务)

根据已存在的 task cards + report pairs，Status 非 `Accepted` 的卡属于
历史遗留（前 Codex 框架产物），需由 coordinator 逐卡判断是否仍需执行或可关闭。
