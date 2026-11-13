# 语音输入（STT）选型与合规（决策材料）

> **状态：owner 已批准方案 B（Qwen `qwen-audio-3.1-asr-flash-message`，松开后转写，无 interim）；V-B/V-C/V-D 已实现并通过本地测试。** 本文件保留选型与合规材料；生产需要服务端 `QWEN_API_KEY`，且本次授权不含该环境变量配置。真实 Qwen 识别质量、时延与 iOS 真机仍未验证。
>
> 基线：`d3bc477b3efeb3954ac55e606e9fe62421c7d9e9`（2026-11-09 发布）。
> 场景：阶段一（单机 AI 对局 + 社交基础），用户以中学生/青少年为主；语音只作为文字发言的辅助输入，默认关闭、按下才启用。

## 1. 现状事实（已核对，作为选型前提）

- `netlify.toml` 的 `Permissions-Policy = "geolocation=(), microphone=(), camera=()"`：浏览器会拒绝 `getUserMedia`，**生产环境当前没有任何可用的麦克风能力**。Vite dev server 不应用这份 header，所以"本地能测"不等于"线上可用"。
- CSP `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cloudflareinsights.com`；`media-src 'self' blob:`；`script-src 'self'` 系；`object-src 'none'`；`frame-ancestors 'none'`。没有 ASR 域。
- `src/components/SpeechInput.tsx`：7 个快捷短语 + 一个自由文本 `<input>` + `Send`；`visible` 由 `src/App.tsx` 传入（`DAY_DISCUSSION && currentSpeaker?.id === MY_PLAYER_ID`）；`onChange` 写 `userInput`，`onSubmit` 调 `handleHumanSpeechSubmit`。组件没有任何录音或识别能力。
- `src/hooks/useGameState.ts`：`SPEECH_DURATION = 60`（L289）；人类发言时钟 L489–539；`handleHumanSpeechSubmit`（L1195）再校验 `canProgress() && currentSpeaker?.id === MY_PLAYER_ID && playerClockRef.current`，之后 `normalizeHumanSpeech(userInput)`；空文本直接 return，**不会自动提交**；提交后 `addLog(...)` 并写入 replay（H2-A）。
- 既有"服务端函数 + 服务端密钥 + 超时 + 回退"范式：`netlify/functions/bailian-tts.cjs`（env 开关、origin 与 Bearer 校验、单次超时、`502 TTS_UNAVAILABLE`、H1-D 单行枚举日志）与 `src/services/cloudSpeechAudio.ts`（英文 22s / 中文 6.5s 请求超时、播放超时、`fallback`）。浏览器侧不持密钥。
- `docs/observability-decision.md` 已把"不采集用户发言、语音或 STT 转写"写成观测硬约束；本文件沿用该口径，不另开一套。
- 仓库当前**没有** STT 依赖、没有音频表、没有语音日志、没有媒体处理依赖。

## 2. 三个候选方案

### A. 浏览器 Web Speech API（`SpeechRecognition` / `webkitSpeechRecognition`）

浏览器原生识别，页面不接触音频字节、不新增函数与密钥，代码量最小。识别在浏览器厂商一侧完成：Chrome 默认把音频送到 Google 的语音服务；Safari 交给 Apple 的听写服务；Edge（Chromium）交给 Microsoft 服务。新版 Chrome 有实验性的 on-device 识别（`processLocally` / `SpeechRecognition.available()`），但版本与新特性门槛高，**不能作为生产假设**，本文件按"服务端识别、需要网络"计。

### B. 云 ASR（同源 `netlify/functions/asr-transcribe.cjs` + 服务端密钥）

浏览器用 `getUserMedia` + `MediaRecorder` 录一段 ≤60s 音频，`POST` 到同源的 `/.netlify/functions/asr-transcribe`；函数校验 origin/方法/大小、在内存里把音频转发给 owner 批准的 ASR 供应商、取回文本后返回，随后丢弃音频。密钥只存在于 Netlify 环境变量，浏览器只请求自己站点的同源路径；Chrome / Edge / Safari / Firefox 走同一条链路，差异只剩识别质量与延迟。复用 `bailian-tts.cjs` 的既有实现范式（含限流、超时、失败状态码、枚举日志）。

### C. 本地 wasm（浏览器内离线模型）

把 Whisper 一类模型（tiny/base 量化）编译成 wasm，在页面里用 WebAssembly 推理；音频**从不离开设备**，可离线。代价是模型资产（约 40–150 MB）、新依赖与构建/缓存策略、移动端内存与 CPU、以及识别质量（tiny 对狼人杀这种带专有名词的短句明显偏弱）。仓库当前"零新依赖"的纪律与一张卡的写入范围都装不下它。

## 3. 对比矩阵

| 维度 | A 浏览器 Web Speech | B 云 ASR（同源函数） | C 本地 wasm |
| --- | --- | --- | --- |
| Chrome | 支持（`SpeechRecognition`/`webkitSpeechRecognition`），需网络与 HTTPS；识别在 Google 服务 | 支持（`getUserMedia` + `MediaRecorder`），全部版本一致 | 支持，但首次要下载模型 |
| Edge | 支持（Chromium），识别走 Microsoft 服务 | 支持 | 支持 |
| Safari iOS | `webkitSpeechRecognition` 约自 Safari 14.1 / iOS Safari 14.5 起提供（以 MDN 兼容数据为准，**未真机验证**）；需用户手势、需网络，`continuous` 行为不稳 | 支持 `getUserMedia` + `MediaRecorder`（Safari 14.1 起，**未真机验证**），需 HTTPS 与用户手势 | 支持 wasm，但无 SharedArrayBuffer（除另行加 COOP/COEP），只能单线程，移动端性能风险最高 |
| Firefox | **无可用实现**，只能文字输入 | 支持 | 支持（性能更弱） |
| 音频是否离开设备 | **是**。Chrome → Google 服务器；Safari → Apple 服务；Edge → Microsoft 服务。页面无法关闭、无法选择本机识别，也无法约定留存 | **是**。先到**我方** `/.netlify/functions/asr-transcribe`（同源），再由函数转发到 owner 点名的 ASR 供应商 | **否**。音频只在浏览器内存里由 wasm 处理，识别不产生网络请求（模型文件下载除外） |
| 是否落库 | 我方不落库；第三方留存策略不可控、无 DPA | 函数只用内存，返回后丢弃；不写 Supabase、不写对象存储、不写日志；供应商侧留存需合同确认 | 不落库；可实现"音频即用即弃" |
| 成本（每条 30s） | $0 直接成本（由浏览器厂商承担） | 供应商计费量级约 $0.002–0.009；具体单价以供应商当前页面为准 | $0 边际成本 |
| 成本（每局 4–6 条） | $0 | 约 $0.01–0.05 | $0（一次性工程与模型资产另计） |
| 成本（1000 局/月） | $0 | 约 $10–50 + 现有 Netlify 计划内的函数调用（约 5k 次/月，远低于免费额度） | $0 边际成本；模型首次下载 40–150 MB/新用户，命中缓存后接近 0 |
| 延迟与稳定性 | 首字约 0.5–2s；依赖浏览器版本与网络；长会话/连续模式易自动结束，错误事件不统一 | 松开后约 1–5s（上传 + 供应商识别 + 函数冷启动）；可用 10–20s 超时 + 文字回退兜底；各浏览器行为一致 | 首次加载模型 5–30s；之后视设备，低端手机可能慢于实时；无网络抖动 |
| 离线可用 | 否 | 否 | 是（模型缓存后） |
| 实现复杂度 | S：只改 `SpeechInput` 与一个 adapter，零新依赖、零新函数 | M：adapter + 1 个函数 + 1 份函数测试 + 1 个密钥/开关 + 限流与超时；无新依赖 | L：新依赖 + 模型资产 + 构建/缓存 + 移动端真机调优，至少 3 张卡 |
| CSP / Permissions-Policy | 需要 `microphone=(self)`；CSP 不需要新域（识别不经页面 `fetch`，浏览器厂商流量不受 `connect-src` 约束） | 需要 `microphone=(self)`；**走同源函数时 CSP 也不需要新域**（`'self'` 已覆盖 `/.netlify/functions/*`）。只有"浏览器直连供应商"才要 `connect-src` 精确域，而那会暴露客户端凭据，不推荐 | 需要 `microphone=(self)` 录音；wasm 从同源加载时 `script-src`/`worker-src` 已有 `'self'`；若模型放 CDN 或开多线程，需另改 CSP/COOP-COEP（未评估） |
| 失败降级 | 拒绝/不支持/断网 → 回到文字输入，提示一句 | 401/403/429/5xx/超时/网络失败 → 回到文字输入，提示一句，音频丢弃 | 模型加载失败/内存不足 → 回到文字输入 |

## 4. 隐私口径（结论先行）

1. **A 和 B 都会让音频离开设备，只有 C 不会。** 因此 owner 的问题"是否允许音频离开设备"实际决定的是：选 A/B，或只能选 C / 暂时不做语音。
2. 我方**不保存音频、不保存中间识别结果**。B 的函数把音频放在内存里转发，响应结束即丢弃；不写 Supabase、不写 Netlify Blobs、不写对象存储、不把音频写进日志。
3. 转写文本的留存**不新增**：用户按 Send 之后，文本走既有 `handleHumanSpeechSubmit` → `addLog`（内存）→ 本地 replay（localStorage），与手打文本完全同路径。语音方案不新增文本留存、不新增表。
4. 若将来要做识别质量分析而需要保存音频或转写，**必须**新增表 + RLS + 保留期 + owner 逐项批准；本文件推荐一律不做，默认 `不落库`。
5. 不做声纹/说话人识别、不做情绪识别、不做语音指纹、不做录音回放、不把音频或转写写进 telemetry/localStorage。
6. 观测侧沿用 `docs/observability-decision.md` 第 5 节：连 STT 转写都不得进入观测事件。函数最多输出**枚举**日志（`asr_timeout` / `asr_rate_limited` / `asr_unavailable`），不含音频、转写、prompt、用户身份。
7. 面向青少年要能直接说清处理方：A 的处理方随浏览器变化（Google / Apple / Microsoft），无法统一披露；B 只需在隐私说明里点名一个供应商；C 不涉及外发。
8. 语音是**可选辅助**：默认不录音、默认文字输入；只有用户主动按住说话才采集，界面必须在按钮附近说明"语音会发送到 <处理方>"。

## 5. 推荐：B（云 ASR，同源 Netlify 函数）

**单一推荐：选 B。** 理由按优先级：

1. **跨浏览器一致**：A 在 Firefox 完全缺失、在 iOS Safari 行为不稳（见第 8 节），而 B 只依赖 `getUserMedia` + `MediaRecorder`，四个浏览器同一条链路；用户报告问题时只需排查一份实现。
2. **隐私可披露、可控制**：A 把音频按浏览器厂商分发，页面既不能选路径也不能约定留存；B 只有一个具名处理方，我方函数能保证"不落库、不写日志、超时即丢"，对青少年产品的隐私说明更站得住。
3. **成本可控且可度量**：一条 30s 约 $0.002–0.009，一局（4–6 条）约 $0.01–0.05，1000 局/月约 $10–50；与当前单局 AI 表达成本（约 $0.05–0.17/局）同量级，通常占其 10–50%，不是数量级变化；可复用 `provider-adapter` 的限流 / 日预算范式做上限。
4. **与仓库既有范式一致**：`bailian-tts.cjs` 已经证明"服务端函数 + 服务端密钥 + 超时 + 回退"能在本仓库落地，V-B 云分支的允许改动已经包含 `asr-transcribe.cjs`。
5. **接缝不变**：B 与 A 共用同一个可注入 adapter 契约（第 6 节），若 owner 后来改主意，只换 adapter 实现，不动 `SpeechInput` 的 `onChange`/`onSubmit`/`visible` 契约。

**不推荐 A 作为主方案**：它的零成本优势被"Firefox 无语音 + iOS 不稳 + 处理方不可披露"抵消；它更适合作为 owner 拒绝新增函数/环境变量时的降级实现。
**不推荐 C 现在做**：模型资产与依赖会突破本阶段"零新依赖、单卡可交付"的纪律，且 iOS wasm 性能与识别质量都要真机验证，至少 3 张卡；只有 owner 把"音频绝不离开设备"定为硬约束时才值得立项。

**选错的代价**

| 如果实际选了 | 代价落在哪 | 具体影响 |
| --- | --- | --- |
| A，但真实用户主要在 iOS/Firefox | V-B、V-C、V-D | 语音对大部分移动用户不可用或不稳；隐私说明要按浏览器逐个解释；后续补 B 要重写 adapter + 新函数 + 新供应商审批（约 +2 卡） |
| B，但 owner 后来不允许外发或不愿新增函数 | V-B、V-D | 要删函数、删环境变量、改写 adapter 为浏览器实现，V-D 的 header 改动仍保留；工期 +1 卡，但不会产生线上残留（未部署） |
| C，但工期与真机条件不足 | V-B 及后续 | 需要先改卡（模型资产、依赖、缓存策略）、真机调优与质量评估；首发至少推迟 2–3 卡，且低端机可能不可用 |
| 暂不做语音 | — | 0 成本 0 风险；核心玩法已由文字与快捷短语覆盖，只是少了辅助输入 |

## 6. 与现有管线的接缝（V-B 必须遵守）

```text
麦克风（push-to-talk，仅本人回合）
  → sttAdapter（A 或 B 的同一契约：onInterim / onFinal / onError / onEnd）
  → SpeechInput 的 onChange → userInput（可编辑，绝不自动提交）
  → 玩家按 Send → onSubmit → handleHumanSpeechSubmit
  → normalizeHumanSpeech → addLog（内存）+ replay（本地）
```

硬约束：

1. **转写只进入 `SpeechInput` 的文本状态**（即 `userInput`），用户可以在按 Send 前修改；`interim` 结果同样只写文本，不自动提交，空结果不改动输入框。
2. **音频与转写都不得发给 LLM 或 TTS**：`sttAdapter` 不得 import 或请求 `provider-adapter` / `genai-proxy` / `bailian-tts` / `aiOrchestrator` / `geminiAdapter` / `cloudSpeechAudio` / `speechAudio`；云分支只允许请求同源的 `asr-transcribe`，函数只把音频转发给 ASR 供应商。
3. **60 秒上限**：从按下开始计时，到 60s 硬停，与 `SPEECH_DURATION = 60` 对齐（常量在 adapter 内集中定义，并注明来源是 `useGameState.ts` L289）。到达上限时停止录音、保留已识别的文本供编辑，**不自动提交**、不再请求麦克风。玩家时钟（`playerClockRef`）到 0 时以先到者为准。
4. **仅本人回合**：麦克风按钮只在 `visible === true` 时渲染并可用（`visible` 已等价于 `DAY_DISCUSSION && currentSpeaker?.id === MY_PLAYER_ID`）；`visible` 变 false、`phase` 变化、组件卸载时立刻停止并 `track.stop()`，丢弃未完成的 interim，不提示错误。
5. **默认 push-to-talk**：按下开始、松开停止，不做常开监听、不做 VAD、不做唤醒词；离开页面/切后台按取消处理。
6. **双分支同契约**：`sttAdapter.ts` 暴露一个可注入的工厂，A 与 B 只是两种实现；`SpeechInput` 不感知具体方案，云分支不得把 key、供应商域名或音频字节泄漏到组件层。

## 7. 权限与降级矩阵

| 场景 | 触发 | 用户可见行为（英文 chrome） | 是否回退文字 | 是否写入文本 / 提交 |
| --- | --- | --- | --- | --- |
| 权限拒绝 | `NotAllowedError` / `SecurityError`（A、B 共用） | 按钮旁一行 "Microphone permission denied"；按钮回到可用但下次点击会再次请求 | 是，输入框与快捷短语照常 | 不写入、不提交 |
| 不支持 | 无 `SpeechRecognition`（A）或无 `navigator.mediaDevices`/`MediaRecorder`（B） | 按钮 `disabled` + "Voice input unavailable in this browser" | 是 | 不写入、不提交 |
| 无结果超时 | 开始录音后约 10s 没有任何 interim/final | 停止并提示 "No speech detected. Please try again." | 是 | 已有文本保留，不提交 |
| 静音 / 空结果 | 识别结束但文本为空 | 提示同上，不修改输入框 | 是 | 不写入、不提交 |
| 用户取消 | 再次点击、按 Escape、`pointerleave`/`pointercancel`、切后台 | 静默停止并丢弃中间态，不弹错误 | 是 | 不写入、不提交 |
| 切阶段 / 失去发言权 | `visible` 变 false、`phase` 变化、`currentSpeaker` 变化 | 静默停止，不提示错误（这是正常流程） | 是 | 不写入、不提交 |
| 云分支补充：网络失败 | `fetch` 抛错 / `AbortError` | "Voice input unavailable. Please type instead." | 是 | 不写入、不提交 |
| 云分支补充：429 / 5xx / 超时 | 函数返回非 2xx 或客户端 10–20s 超时 | 同上，一次提示；音频丢弃，不重试 | 是 | 不写入、不提交 |
| 云分支补充：函数被关闭 | `ASR_ENABLED !== 'true'`（复用既有 env 开关范式） | 按钮 `disabled` + "Voice input unavailable in this browser"（必要时按功能开关隐藏） | 是 | 不写入、不提交 |

所有分支都不得抛出未捕获异常；任何失败都不得阻塞回合、不得停掉 60s 时钟、不得自动跳过发言。

## 8. iOS Safari：支持现状、风险与"未验证"

- **A（Web Speech）现状**：iOS Safari 的识别入口是 `webkitSpeechRecognition`，约自 iOS Safari 14.5 起提供（Safari 桌面版约 14.1；以 MDN 兼容数据为准）。需要 HTTPS、需要用户手势触发，识别由 Apple 服务处理（部分场景可能在本机完成，但页面既不能确认也不能强制）。`continuous` / `interimResults` 在 iOS 上行为不稳，长回合容易提前结束；PWA 独立窗口与内嵌 WebView（微信、Instagram、TikTok 等）可能完全不可用。**本仓库未在 iOS 真机验证，不得写成"已支持"。**
- **B（云 ASR）现状**：依赖 `getUserMedia` + `MediaRecorder`；Safari 14.1 起提供，需要 HTTPS、`Permissions-Policy` 允许、用户手势解锁；`MediaRecorder` 产出的容器在 Safari 上是 mp4/aac，而 Chrome 是 webm/opus，函数与供应商必须同时接受两种格式（或前端统一转码，转码会额外增加依赖与 CPU）。
- **共同风险**：首次授权弹窗只出现一次，用户拒绝后只能到系统设置里改；iOS 的"静音开关"不影响麦克风采集但会影响播放；来电/切后台/锁屏会中断录音，必须按取消处理；低电量模式与旧机型可能限制录音；内嵌浏览器权限链路未验证。
- **验证口径**：V-A 只读材料，无真机；V-B 的验收允许用注入式假 adapter 与桌面 Chromium 覆盖逻辑，但 **iOS Safari、Firefox、真实麦克风与真实识别质量一律记为 `未验证`**，由 V-C 的 Playwright（仅 Chromium）与人工真机验收补。未完成前，发布说明只能写"语音输入在部分浏览器可用，iOS 未验证"。

## 9. 成本估算口径

- 计量单位：音频秒 → 每条发言（假设平均 30s，上限 60s）→ 每局（假设人类 4–6 条）→ 每月（假设 1000 局）。
- **A**：直接成本 $0；代价是无法度量、无法设定上限，且跨浏览器体验不一致。
- **B**：供应商单价量级约 $0.00007–0.0003/秒（按公开定价折算，**须在采购前按供应商当前页面核实，本文件不作为采购依据**）；30s 约 $0.002–0.009；60s 上限约 $0.004–0.018。每局 4–6 条约 $0.01–0.05；1000 局/月约 $10–50。Netlify 函数调用约 5k 次/月，在现有计划内；上传带宽按 16kHz 单声道 16-bit 未压缩 30s≈0.96MB 计，压缩格式（webm/opus 或 aac）会小一个数量级；1000 局/月约 1–5GB，仍在 Netlify 带宽额度内。
- **B 的大小约束**：Netlify Function 的同步请求体上限为 6 MB（AWS Lambda 限制，**未在本仓库实测**）。60s 未压缩 16kHz/16-bit 约 1.9MB，base64 后约 2.6MB，可以放进一次请求；超过 6MB 的方案必须降采样、改压缩格式或分片，不能默默失败。
- **C**：边际成本 $0；一次性成本是模型资产（40–150MB/新用户首次下载）、新依赖、构建与缓存策略、真机调优人力。
- **结论**：B 的成本可预估、可限额，与现有单局 AI 表达成本同量级（通常占 10–50%）；A 的"免费"换来的是不可控的体验与隐私；C 的成本在工程侧而不是账单侧。

## 10. V-B 两个分支的文件清单（与 `tasks/V-B.md` 对齐）

**共同部分（浏览器分支与云分支都允许）**

- `src/services/sttAdapter.ts`（新建：adapter 契约 + 实现之一）
- `src/services/sttAdapter.test.ts`（新建）
- `src/components/SpeechInput.tsx`（加麦克风按钮与状态；保持既有 preset / `onChange` / `onSubmit` / `visible` 契约）
- `src/components/SpeechInput.test.ts`（扩展）
- `src/App.tsx`（仅当需要向 `SpeechInput` 传新 props）

**浏览器分支（A）额外**：无。零网络请求、零新函数、零 env；`netlify.toml` 仍归 V-D。

**云分支（B）额外**：

- `netlify/functions/asr-transcribe.cjs`（新建：origin/方法/大小/超时校验，密钥只读 `process.env`，只返回文本或明确状态码）
- `netlify/__tests__/asr-transcribe.test.js`（新建）
- `.env.example`（仅追加变量名与注释占位，不得出现真实值）

**共同禁止**：`netlify.toml`、CSP、`package.json`/`package-lock.json`、`src/hooks/useGameState.ts`、`src/gameEngine.ts`、`src/ai/**`、`src/services/cloudSpeechAudio.ts`、`src/services/speechAudio.ts`、`src/replay/**`、`README.md`、`docs/**`。

**若 owner 选 C**：V-B 现有的 Allowed changes **不够**——需要模型资产、可能的新依赖与缓存/构建改动，coordinator 必须先改卡，不能由 V-B 自行引入大文件或依赖。

## 11. V-D 需要的 header 改动

唯一必须的改动（两个分支都需要）：

```diff
- Permissions-Policy = "geolocation=(), microphone=(), camera=()"
+ Permissions-Policy = "geolocation=(), microphone=(self), camera=()"
```

CSP：

- **A（浏览器 Web Speech）**：不追加任何域。识别由浏览器实现，音频外发不经过页面 `fetch`，`connect-src` 不生效。
- **B（同源函数）**：**不追加任何域**。浏览器请求的是 `/.netlify/functions/asr-transcribe`，属于 `'self'`；供应商域由函数在服务端访问，不受页面 CSP 约束。
- 只有"浏览器直连供应商"（需要临时 token/客户端凭据）才需要 `connect-src` 追加精确域，例如 `https://<asr-host>`；**本文件不推荐该形态**，也不允许 `https://*.<host>` 宽泛通配。若 owner 确实要直连，V-D 的追加必须与 V-B 实际请求端点逐字一致。
- `media-src 'self' blob:` 保持不变；`getUserMedia` 录音不经 `media-src`。`Permission-Policy` 之外的 header（`script-src`、`object-src`、`frame-ancestors`）一律不动，不得为省事加 `unsafe-eval`。

边界：V-D 只改 `netlify.toml` 的这两行、不部署；改动上线前，生产环境仍然没有麦克风能力，任何"语音已可用"的说法都不成立。

## 12. 残留风险与未验证项

- 未在 iOS Safari / Android / Firefox 真机验证；A 的 iOS 行为、B 的 `MediaRecorder` 容器格式兼容性均为 `未验证`。
- 未实测真实识别质量、端到端延迟、函数冷启动；未确认所选供应商是否支持直接上传音频字节（若只接受公网 URL，就会被迫引入对象存储，与"不落库"冲突，必须在 V-B 开工前排除）。
- 供应商单价、免费额度、数据区域与留存策略未核实；跨境链路（如国内供应商）对海外青少年用户的影响需 owner 判断。
- Netlify Functions 的 6MB 请求体上限、60s 音频的实际大小与压缩格式影响未实测。
- `Permissions-Policy: microphone=()` 是否也会拦截 Web Speech 的识别路径因浏览器实现而异，**未验证**；因此不能以"浏览器分支不用改 header"为前提。
- 本文件是决策材料，所有内容都不代表能力已上线；`V-B` / `V-D` 的实现与线上验收另计。

## 13. 需要 owner 拍板的问题（3 条）

| # | 问题 | 推荐 | 影响与选错代价 |
| --- | --- | --- | --- |
| D3 | STT 方案选 A / B / C？ | **B（云 ASR，同源函数 + 服务端密钥）**：跨浏览器一致、处理方可披露、成本 1000 局/月约 $10–50 | 选 A：Firefox 无语音、iOS 不稳、处理方随浏览器变化，后续补 B 约 +2 卡；选 C：需改卡、加依赖与模型资产，至少 +2–3 卡并推迟首发 |
| D5 | 是否允许音频离开设备（到自家函数，再转发给一个 owner 点名的 ASR 供应商，不落库）？ | **允许**，但仅限用户主动 push-to-talk、仅在本人发言回合、函数不落库不记日志 | 不允许：A 同样会外发（Google/Apple/Microsoft），所以只剩 C 或"暂不做语音"；允许：需在隐私说明里点名处理方，并接受供应商侧留存以合同为准 |
| D6 | 是否允许新增 1 个服务端函数与相应环境变量（ASR 密钥 + 开关）？ | **允许**，密钥只进 Netlify 环境变量，仓库与 `.env.example` 只有变量名 | 不允许：退回 A，接受跨浏览器与隐私代价；允许：多 1 个函数的运维、限流与密钥轮换责任，V-B 云分支才可开工 |

**未拍板前 V-B 与 V-D 都不能开工。** V-B 的第一条依赖就是 owner 对 D3 的明确选择（V-A 的推荐不构成批准）；V-D 需要 owner 对 `microphone=(self)` 与（若适用）CSP 追加域的逐项批准。在答复落盘前，V-B / V-D 保持 `Queued`，V-C 也随之后移。
