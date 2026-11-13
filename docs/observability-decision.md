# 观测与错误监控选型（决策材料）

> **状态：owner 已选方案 A；H1-D 已实现“本地事件 + 现有 Netlify Function 日志”，未接入第三方、未建表、未改 CSP。** 本文件保留选型材料；代码已合入，但生产日志检索与真实用户数据仍未验证。
>
> 基线：`d3bc477b3efeb3954ac55e606e9fe62421c7d9e9`（2026-11-09 发布）。
> 场景：AI Werewolf 阶段一（单机 AI 对局 + 社交基础），用户以中学生/青少年为主。

## 1. 现状事实（已核对，作为选型前提）

- CSP `connect-src` 仅为 `'self' https://*.supabase.co wss://*.supabase.co https://cloudflareinsights.com`，没有第三方观测域；`script-src` 含 `static.cloudflareinsights.com` 与 Turnstile。`cloudflareinsights.com` 是 Turnstile 的附带流量，仓库内没有主动埋点。
- `provider-adapter.cjs` 已有错误分类（`timeout|authentication|rate-limit|upstream|unavailable`）、2 次/60s 熔断、30 次/分/IP 限流、日预算（默认 `$0.05`），响应体已带 `model_used`/`cost_estimate`/`fallback_used`；但**不输出结构化日志**，任何失败都折叠为 `200 + localResult()`。
- `bailian-tts.cjs` 把上游非 2xx 与超时统一折叠为 `502 TTS_UNAVAILABLE`，客户端无法区分原因。
- `geminiAdapter.generateWithGemini` 只返回字符串，丢弃 `model_used`/`cost_estimate`/`fallback_used`；`cloudSpeechAudio.ts` 把 429/超时/非 wav 都折叠为 `fallback`（对外只暴露 `BrowserFallback | null`）。
- Netlify Function 日志可按函数名查询，但**没有跨实例聚合、没有仓库侧留存策略、没有看板或告警**。
- 本地已有成熟 localStorage 先例：`werewolf_display_language`、`werewolf_audio_prefs`、`aiwerewolf:identity:guest:v1`、`aiwerewolf:lobby-features:v1:*`，均为 try/catch 容错；私密模式下静默降级。

## 2. 候选方案

### A. 仅本地事件 + 现有 Netlify Function 日志

浏览器按"单局"把事件聚合进 localStorage（成本累加、回退/超时/429 计数、完成与退出）；服务端只按 H1-D 的边界补单行结构化日志，不新增函数、不新增表、不接第三方。观测数据不新增外发，CSP 零变更。

### B. 自建 `netlify/functions/events.cjs` 汇总

新增同源事件端点：客户端批量上报白名单字段（匿名、无文本），函数写 Supabase 或结构化日志；**是否落 Supabase 由 owner 决定**（当前默认不允许）。不新增第三方、不改 CSP（同源 `'self'` 已覆盖）；新增 1 个函数，可能新增表/RLS/迁移。

### C. 第三方 SaaS（错误监控或产品分析）

接入 Sentry（错误监控）或 PostHog（产品分析）一类 SDK，换取现成看板、告警、崩溃聚合。代价是数据离开设备到第三方、CSP 需追加精确 ingest 域、需要 DPA/隐私评审与依赖变更；对青少年首阶段产品是最高门槛。

## 3. 对比矩阵

| 维度 | A 本地 + 函数日志 | B 自建 events 函数 | C 第三方 SaaS |
| --- | --- | --- | --- |
| 数据是否离开设备 | 不新增外发；只沿用既有 provider/TTS 请求 | 离开设备，但只到自家函数（可选自家 Supabase） | 离开设备到第三方，通常跨境 |
| CSP 影响 | 无；不改 `connect-src` | 无；同源路径属于 `'self'`；若浏览器直连 Supabase，`https://*.supabase.co` 已在白名单，但仍应走函数 | 必须改 `connect-src`，从所选项目 DSN 逐字复制精确域（如 `https://o<org>.ingest.sentry.io`、`https://us.i.posthog.com`）；用 loader 时还要 `script-src`；禁止 `*` |
| PII 口径 | 字段仅本地；匿名标识=每局随机 UUID，仅本地去重；保留最近 20 局或 30 天；不可关联账号。函数日志只有平台元数据（IP/UA/path/status），无请求体 | 白名单字段：event、board、model_used、cost_estimate、fallback_used、error_class、latency_bucket、每局随机 id；服务端 ≤30 天定时删除；不写 prompt/文本/user_id/email/IP，不可关联账号 | 默认收 IP/UA/URL/面包屑；须关 `sendDefaultPii`、autocapture、session replay 并约定保留期；不允许 `identify()`，不可关联账号；需 DPA |
| 成本 | 增量 $0；单位=localStorage 字节 + 现有 Netlify plan 内日志；单局约 60–120 个事件，无独立计价 | 单位=Function 调用/行/存储；调用计入现有 Netlify plan，Supabase 免费额度内 1000 局/月≈10 万行可忽略；单局 1 行汇总或 ≤120 行明细 | 单位=events/errors；Sentry 免费档约 5k errors/月、PostHog 约 1M events/月（以供应商当前页面为准）；单局 60–120 events |
| 采样 | 本地 100%，环形缓冲（最近 20 局 + 累计计数器） | 100% 或按局采样（如 25%），批量 1 次/局或 30s 一次，失败丢弃不重试 | 供应商自适应采样，采样率可能随 plan 调整 |
| 失败影响 | localStorage 禁用/写满 → 静默丢弃；游戏完全不受影响 | 函数超时/失败 → fire-and-forget 丢弃；不得阻塞开局、发言、结算 | SDK/CSP/网络故障 → 控制台噪音或数据缺失；必须异步 + try/catch，否则可能拖慢启动 |
| 上线复杂度 | S：0 函数、0 表、0 密钥、0 header、0 依赖（H1-D 已覆盖） | M：1 函数 + 可选 1 表 + RLS + 迁移 + owner 审批；无需第三方密钥 | L：1 依赖 + 公共 DSN（非密钥但需配置）+ CSP/header 审批 + DPA/隐私评审 + owner 审批 |

## 4. 现有日志 + 本地事件够不够

**够用于**：单局成本（`cost_estimate` 累加）、回退率、provider/TTS 失败计数、单局完成/退出、单点排查（按函数名 + 时间窗查看日志）。这正是 H1-D 的范围。

**不够用于**：跨用户聚合（不同函数实例不共享内存，日志无跨实例聚合）、7 日/30 日趋势看板、阈值告警、前端崩溃与 CSP 违规、上游错误类型分布（`bailian-tts` 折叠 502，无法区分超时/429/内容非法）、留存期与删除策略（平台日志不由仓库控制）。

结论：**A 足以支撑"成本/回退/完成率"决策，不足以支撑"跨用户看板与告警"**；后者是 B/C 的立项理由，不是首阶段上线门槛。

## 5. PII 与青少年硬约束（任何方案都必须遵守）

1. 不采集用户发言、AI 生成文本、狼聊内容、语音或 STT 转写。
2. 不采集账号身份（auth uid、email、username、nickname），观测事件不可与账号关联。
3. 不做设备指纹（canvas/WebGL/字体/音频指纹、UA 全串散列）；不做广告或用户画像。
4. 匿名 id 只用每局随机 UUID 做本地去重，不复用 `guest:` principal，避免变成跨局稳定标识。
5. 事件字段白名单写死；任何新增字段需 owner 批准。
6. 保留期：本地最近 20 局或 30 天；服务端若落库 ≤30 天并定时删除；不接入 session replay / autocapture。
7. 注意：Netlify 平台日志本身会记录 IP/UA/path/status（由平台控制），本卡不承诺"日志无 IP"；若 owner 要求连平台日志也匿名，需另议替代方案。

## 6. 成本与单局事件量估算（判断是否需要 B/C 的依据）

- 按现有 `MODEL_REGISTRY`，一次 Gemini 3.6 表达的估算成本约 `$0.0025–0.0042`（输入 375–625 tokens + 256 输出 tokens）；默认日预算 `$0.05` 约等于每实例每天 12–20 次调用。
- 一局 9/12 人对局约 20–40 次表达调用、60–120 个本地事件（含回退）；回退是常态而非异常，因此"回退率/成本"是最值得观测的两个指标。
- 以每局 100 事件、1000 局/月估算：B 约 10 万行/月（可忽略）；C 约 10 万 events/月，处在常见免费档的 1/5–1/10。价格与免费额度需在采购前按供应商当前页面核实，**本文件不作为采购依据**。

## 7. 推荐

**首阶段选 A（即 H1-D 的范围），不新增第三方、不加表、不改 CSP。** 理由：单机阶段真实用户量与风险都不支持第三方数据外流；A 与现有 CSP/零依赖纪律和 ADR-003"按指标决定架构"一致；A 已能回答"成本是否失控、回退是否异常、对局是否完成"。

**B 是唯一值得考虑的升级路径**，建议触发条件：出现约 ≥50 名真实日活或需要 7 天错误率告警，且 owner 批准新表/迁移（默认不允许）。B 可先只做函数 + 结构化事件日志，确认价值后再落库。

**C 暂不推荐**：为中学生用户引入第三方数据外流、CSP 变更、DPA 与依赖维护，收益（现成看板/告警）在阶段一可由 A 的人工查询替代；若多人阶段需要崩溃聚合，再按新卡重新评估。

## 8. 需要 owner 拍板的问题（≤4）

| # | 问题 | 推荐 | 选错的影响 |
| --- | --- | --- | --- |
| Q1 | 是否允许新增 Supabase 表或迁移来存观测事件？（当前默认：不允许） | 暂不允许；只有选 B 且 A 的本地数据证明不足时再单卡申请 | 选"允许"会扩大 schema/RLS/备份面，需迁移评审；选"不允许"则 B 只能落函数日志，跨用户聚合能力受限 |
| Q2 | 是否允许第三方 SaaS 接收用户侧数据（含 IP/UA）？ | 不允许（至少阶段一）；如未来允许，需同时批准 CSP 精确域与 DPA | 选"允许"将触发 CSP 变更、隐私政策/家长同意与跨境数据问题，并引入依赖与供应商锁定 |
| Q3 | 观测数据的保留期与匿名口径是否按第 5 节作为硬约束？ | 是：无文本、无账号、无指纹、每局随机 id、≤30 天 | 放宽任一条都会把"产品分析"变成"个人信息处理"，与青少年用户定位冲突 |
| Q4 | 跨用户看板与告警是否属于首阶段发布门槛？ | 不是；阶段一以本地成本/回退 + 函数日志手工查询验收 | 若定为门槛，首阶段发布要等 B/C 落地（多 1–2 张卡 + owner 批准），发布节奏被观测方案绑住 |

## 9. 后续卡建议（若 owner 选相应方案）

**若选 A（推荐）**

1. `H1-D`（已在队列）：函数单行结构化日志 + 本地单局成本/回退聚合，无新表、无 CSP。
2. 可选 `A-OBS-RUNBOOK`：新增 `docs/observability-runbook.md`，写清日志查询步骤、字段口径、已知盲区与手工核对流程（只写文档，避免把隐性知识留在会话里）。

**若选 B**

1. `B-EVENTS-ENDPOINT`：新增 `netlify/functions/events.cjs`（字段白名单、每局随机 id、采样、204、无重试），不改 CSP。
2. `B-EVENTS-TABLE`：Supabase 事件表迁移 + RLS（仅服务端写、禁止匿名读写）+ 30 天清理；必须先获 owner 对 Q1 的批准。
3. `B-EVENTS-QUERY`：只读聚合 SQL/脚本 + 每日成本与回退报表（不新增常驻服务，不接第三方）。

**若选 C**

1. `C-VENDOR-REVIEW`：供应商选型 + DPA/隐私评审（含未成年口径、数据区域、PII 开关、免费额度与超量价）。
2. `C-CSP`：按所选 DSN 追加 `connect-src` 精确域（必要时 `script-src`），单独卡 + owner 批准，参照 V-D 流程。
3. `C-SDK`：客户端 SDK 接入与失败隔离（异步、超时、try/catch、CSP 违规可见），并验证不阻塞开局。

## 10. 与 H1-D / V-D 的边界

- **H1-D** 只做 A 范围内的运行时埋点（函数单行日志 + 本地单局聚合），不依赖本卡结论；本卡不写埋点、不改响应契约、不加字段。H1-D 的日志与本地成本聚合可直接作为 A 的实施证据。
- **V-D** 只处理语音输入（STT）所需的 `Permissions-Policy`/`connect-src` 变更，授权范围不含观测域。若 owner 选 C，观测域变更必须另开 header 卡，不能塞进 V-D；若选 A/B，header 不需要任何变更。

## 11. 残留风险与未验证项

- Netlify 平台日志的实际留存期、免费额度与"按函数名查询"的可用范围未核实（需 owner 控制台确认）；本文件未核实供应商价格。
- 本地事件会被隐私模式/清空浏览器数据/换设备清除，不能代表真实用户完成率。
- `provider-adapter` 把失败折叠为 `200 local-fallback`、`bailian-tts` 折叠为 502 的情况下，函数日志无法区分上游 401/429/超时；H1-D 合入前这是盲区。
- 未验证第三方 SDK 的体积与移动端首屏影响（选 C 时需测），也未验证 Netlify 日志是否包含可用于关联一次请求的稳定 id。
- 本文件为决策材料，不代表任何能力已上线。
