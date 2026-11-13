# 难度校准样本（H2-D）

本目录保存**按难度分层**的本地匿名回放，供 `scripts/difficulty-calibration.mjs`
计算 easy / normal / hard 三档的四个校准指标。它们**不是生产用户数据**，也不能
用于推断线上玩家行为或外部 provider 质量。

## 样本表

| 文件 | 难度 | `boardId` | 语言 | 人类角色 | 终局 | 轮数 | AI 发言 | AI 投票 | 人类发言（占位） | 来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `easy/local-9p-easy-001.replay.json` | easy | `9-standard` | zh | Witch | WEREWOLVES | 3 | 14 | 13 | 0 | H2-D 捕获（r1 重捕） |
| `easy/local-9p-easy-002.replay.json` | easy | `9-standard` | zh | Seer | WEREWOLVES | 4 | 21 | 18 | 1 | H2-D 捕获（r1 重捕） |
| `easy/local-12p-easy-001.replay.json` | easy | `12-standard` | zh | Werewolf | WEREWOLVES | 5 | 40 | 37 | 4 | H2-D 捕获（r1 重捕） |
| `normal/local-9p-001.replay.json` | normal | `9-standard` | zh | Werewolf | WEREWOLVES | 2 | 16 | 14 | 2 | H2-C 样本拷贝 |
| `normal/local-9p-002.replay.json` | normal | `9-standard` | zh | Seer | VILLAGERS | 2 | 14 | 12 | 0 | H2-C 样本拷贝 |
| `normal/local-12p-001.replay.json` | normal | `12-standard` | zh | Villager | WEREWOLVES | 5 | 39 | 36 | 1 | H2-C 样本拷贝 |
| `hard/local-9p-hard-001.replay.json` | hard | `9-standard` | zh | Witch | WEREWOLVES | 3 | 15 | 14 | 0 | H2-D 捕获（r1 重捕） |
| `hard/local-9p-hard-002.replay.json` | hard | `9-standard` | zh | Werewolf | WEREWOLVES | 4 | 21 | 18 | 1 | H2-D 捕获（r1 重捕） |
| `hard/local-12p-hard-001.replay.json` | hard | `12-standard` | zh | Seer | WEREWOLVES | 5 | 40 | 37 | 1 | H2-D 捕获（r1 重捕） |

每档 3 局（9 人 2 局 + 12 人 1 局），共 9 局，全部 `schemaVersion: 1`、游客、
**`language: "zh"`**。AI 发言/投票数为去掉人类条目后的数量；
`[human speech omitted]` 是人类公开发言的固定占位符（9 局共 10 条：easy 5、
normal 3、hard 2）。

`normal/` 三份文件是 `src/ai/__fixtures__/replays/` 中 H2-C 样本的**逐字节拷贝**，
SHA-256 与 H2-C 报告一致（`local-9p-001` `b80fa2fe…73258`、`local-9p-002`
`56798063…3d892`、`local-12p-001` `04b9d2ea…d9922`）。拷贝而不是就地引用，是为了
让本目录自带一份完整、可分层读取的样本集；H2-C 的样本目录保持只读。

## 来源与捕获方式

- **easy / hard（6 局，r1 重捕为 `zh`）**：2026-11-12（Asia/Shanghai）在本仓库本地
  Vite dev server（`http://127.0.0.1:4174`，属于 `geminiAdapter.isLocalVite()` 的
  短路端口集合 4173–4175）上，用 Playwright（headless Chromium）驱动真实 UI 打完
  `GAME_OVER`：Guest Trial → Single-Player → 9 或 12 人标准场 → 在 setup 中选中
  对应难度 → 用真实按钮推进夜晚/发言/投票。
- **语言设置**：捕获驱动在页面加载前把显示语言写为 `zh`（等价于应用内
  Settings → “AI speech language: Chinese”，持久化在
  `localStorage['werewolf_display_language']`）。`startGame` 在点击 Start Game 时
  快照显示语言作为整局 `gameLanguage`，回放因此记录 `language: "zh"`；驱动在落盘前
  断言 `replay.language === 'zh'`，否则视为捕获失败。
- 终局后读取 `localStorage['werewolf.replays.v1'].replays[0]`（即 H2-A
  `exportReplay` 的等价 JSON），把人类公开发言替换为 `[human speech omitted]` 后落盘。
- 捕获驱动是**一次性脚本，未进入仓库**（与 H2-C 的做法一致）；本目录只保存脱敏后的
  回放。人类座位的操作由脚本代打：发言填 `Pass`、放逐票投第一个可选存活座位、
  夜间动作优先 `PASS`。因此人类操作是固定策略，不是真人行为。
- **捕获批次**：easy/hard 6 局是 H2-D 的同一批捕获（2026-11-12 16:31–16:39 CST）；
  normal 3 局来自 H2-C 当日更早的批次（本地 Vite `http://127.0.0.1:5173`）。三档
  语言已统一为 `zh`，但**捕获批次不同**；本目录的样本表已如实标注来源。
- **网络边界**：r1 重捕的 6 局在捕获时逐请求计数，`/.netlify/functions/` 请求均为
  **0**，外部请求只有字体/头像/CAPTCHA 静态资源（`fonts.googleapis.com`、
  `fonts.gstatic.com`、`api.dicebear.com`、`challenges.cloudflare.com`），没有任何
  模型调用；捕获驱动未保留完整请求日志（临时脚本未入库），这是计数而不是归档证据。
  normal 3 局的捕获证据见 `src/ai/__fixtures__/replays/README.md`（同样为 0 个
  Function 请求、仅静态资源）。TTS 若发起请求，只会是同源
  `/.netlify/functions/bailian-tts`，开发服务器无该函数时走浏览器回退。

## 语言一致性守卫

`scripts/difficulty-calibration.mjs` 会汇总每档样本的 `language`：

- 报告“样本”表有 `语言` 列（本目录显示 `zh ×3`）；
- 若 9 局出现多于一种语言，报告与结论会打印
  `样本语言不一致（…）：跨档比较混入语言变量，仅作方向性观察，不据此调参`；
- 单测覆盖了“混语言必须告警”的行为，避免再次把语言不同的样本当成同口径对比。

本目录 9 局逐份核对均为 `zh`。

## 脱敏处理

- `players` 只有 `{ seat, role, isHuman }`：没有玩家名、头像、邮箱、token、
  `userId` 或账号信息。
- 人类公开发言一律替换为 `[human speech omitted]`。
- AI 发言、AI 投票 `reason`、狼队夜聊、查验链保持回放原样（属于对局内容，不是
  身份元数据）。
- `gameId` 是 H2-A 生成的本地随机 UUID，只用于去重/索引，不是账号 id；
  `createdAt` 是 schema 必填的终局时间戳。
- 脚本加载 fixture 时调用 `benchmarkFixtures.parseReplayFixture()`：身份类键、
  未替换的人类发言、邮箱串、schema 之外的顶层/座位键都会被**拒绝**，不是静默清洗。

## 非生产声明

这 9 局都是开发者本地、无密钥、无外部模型的开发环境对局；其中 6 局（easy/hard）的
人类操作由捕获脚本代打。**不是生产用户数据**，不能推断线上用户行为、留存或满意度，
也不能推断外部 provider 的质量。样本量（每档 3 局）只够做方向性观察。

## 不要手工编辑

- 不要用手写/合成 JSON 冒充真实回放；新增样本必须来自真实对局。
- 修改样本后运行 `node scripts/difficulty-calibration.mjs --fixtures src/ai/__fixtures__/calibration`
  并同步更新 `docs/difficulty-calibration.md` 的结果表。
- 采样口径（难度分档、语言、板型、脱敏）与 `docs/difficulty-calibration.md` 保持一致。
