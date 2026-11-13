# 本地回放 benchmark 样本（H2-C）

本目录只保存**本地真实对局**的匿名回放，供 `src/ai/benchmark.test.ts` 与
`scripts/replay-to-benchmark.mjs` 使用。它们**不是生产用户数据**，也不用于推断外部
模型质量。

## 样本表

| 文件 | `boardId` | 难度 | 语言 | 人类角色 | 终局 | 轮数 | AI 发言 | AI 投票 | `schemaVersion` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `local-9p-001.replay.json` | `9-standard` | `normal` | `zh` | Werewolf | WEREWOLVES | 2 | 16 | 14 | 1 |
| `local-9p-002.replay.json` | `9-standard` | `normal` | `zh` | Seer | VILLAGERS | 2 | 14 | 12 | 1 |
| `local-12p-001.replay.json` | `12-standard` | `normal` | `zh` | Villager | WEREWOLVES | 5 | 39 | 36 | 1 |

（AI 发言/投票数为去掉人类条目后的数量；原始 `speeches`/`votes` 数组还包含人类条目。）

## 来源与捕获方式

- 环境：本仓库本地 Vite dev server，`http://127.0.0.1:5173`。`geminiAdapter` 在
  5173/4173–4175 端口直接短路，AI 表达走仓库内本地发言库；`bailian-tts` 未启用，
  TTS 走浏览器回退（不可用时静音）。因此整局**不调用任何外部模型、不需要密钥**。
- 流程：Playwright（headless Chromium）驱动完整对局——Guest Trial → 单人
  9/12 人标准场 → 打到 `GAME_OVER`；终局后读取
  `localStorage['werewolf.replays.v1'].replays[0]`（即 H2-A `exportReplay` 的等价
  JSON），再用一次性脚本把人类发言替换为 `[human speech omitted]` 后写入本目录。
  临时捕获脚本不进入仓库。
- 捕获时间：2026-11-12（本地时区 Asia/Shanghai）。三局都是游客、
  Intermediate（`normal`）、中文 AI 表达。
- 捕获会话的外部请求只有字体、头像与 CAPTCHA 静态资源；`/.netlify/functions/`
  请求数为 0，没有任何模型调用。回放转换、`--check` 与测试本身零网络。
- `local-9p-002` 的人类预言家在首夜被淘汰，因此该局没有人类公开发言；人类投票
  条目仍保留在 `votes` 中，只是不进入评测。

## 脱敏处理

- `players` 只有 `{ seat, role, isHuman }`：没有玩家名、头像、邮箱或账号 id。
- 人类公开发言一律为 `[human speech omitted]`；AI 发言、AI 投票 `reason`、狼队
  夜聊保持回放原样（属于对局内容，不是身份元数据）。
- 不含邮箱、token、`userId`、session、原始语音转写或真实账号信息。
- `gameId` 是 H2-A 生成的本地随机 UUID，只用于去重/索引，不是账号 id。
- `src/ai/benchmarkFixtures.ts` 的加载器会**拒绝**含身份键（`name`/`email`/`token`/
  `userId` 等）或仍含未脱敏人类发言的文件，而不是静默清洗。

## 非生产声明

这些样本是开发者在本地无密钥、无外部模型的开发环境中真实打出的对局，
**不是生产用户数据**，不能用来推断线上用户行为、留存、满意度或外部 provider
质量。样本量为 3 局（其中 12 人局 1 局），任何对比结论都只能是方向性的。

## 不要手工编辑

- 不要把合成/手写 JSON 放进本目录冒充真实回放。
- 修改或新增样本必须同时更新 `src/ai/benchmarkFixtures.ts` 的
  `EXPECTED_BENCHMARK_RESULTS` 与 `src/ai/benchmark.ts` 的阈值注释/文档表格，
  并运行 `node scripts/replay-to-benchmark.mjs --check`。
