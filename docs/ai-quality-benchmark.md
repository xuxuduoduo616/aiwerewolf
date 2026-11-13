# AI 质量 benchmark（本地回放，H2-C）

本文说明如何把本地真实对局的匿名回放（H2-A，`schemaVersion: 1`）确定性地转换为
benchmark 记录、指标如何定义、阈值从哪来，以及如何在干净仓库里复现。**样本是
开发者本地无外部模型的对局，不是生产用户数据；本文不给出任何外部 provider 的
质量结论。**

## 方法

```
ReplayRecord (src/ai/__fixtures__/replays/*.replay.json, schemaVersion 1)
  → ReplayInput / ScriptedTurn            (src/ai/benchmarkFixtures.ts)
  → runReplay()                           (src/ai/evaluation.ts, 确定性离线 runner)
  → RoleEvaluationReport                  (illegalActionRate / speechRepetitionRate /
                                           infoLeakageRate / estimatedCostUSD)
  + voteRationalityScore / roleConsistencyScore   (benchmarkFixtures.ts 的派生口径)
  → GameBenchmarkResult                   (src/ai/benchmark.ts 契约)
```

固定口径：

- **只回放 AI 轮次**：每轮先按记录顺序回放 AI 公开发言，再回放 AI 投票；人类发言
  （占位符）与人类投票不进入 `runReplay`。因此指标描述 AI 表达/行动，不含人类行为。
- **行动来源**：回放只记录放逐投票，不记录夜间行动目标，所以 `illegalActionRate`
  只覆盖日间投票提案；`targetId: null` 的弃票不算“尝试的行动”，不进入分母。
- **存活假设**：回放 schema 没有逐回合存活快照，评测把全部座位视为存活。这保证
  记录中的票按当时轮次判定合法；也意味着“投已死亡座位”无法被本指标识别。
- **行为 variant**：固定 `balanced`（回放不记录表达层设置；mock provider 原样回显
  录制的发言，variant 只影响 prompt 文本）。
- **确定性**：无时间戳、无随机 id、无网络；同一 fixture 字节 → 同一 benchmark 字节。
  `estimatedCostUSD` 使用名义代理费率（见下），不是账单。
- **`src/ai/evaluation.ts` 未改动**：两项正向分数在 `benchmarkFixtures.ts` 中由回放
  的 `votes` 与 `beliefSnapshots` 派生，没有另起评测器。

## 样本

| fixture | 板型 | 难度 | 语言 | 人类角色 | 终局 | 轮数 | AI 发言 | AI 投票 | 来源/捕获 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `local-9p-001` | 9 人标准场 | normal | zh | Werewolf | WEREWOLVES | 2 | 16 | 14 | 本地 Vite 5173 + Playwright 完整对局 |
| `local-9p-002` | 9 人标准场 | normal | zh | Seer | VILLAGERS | 2 | 14 | 12 | 本地 Vite 5173 + Playwright 完整对局 |
| `local-12p-001` | 12 人标准场 | normal | zh | Villager | WEREWOLVES | 5 | 39 | 36 | 本地 Vite 5173 + Playwright 完整对局 |

- 均在 2026-11-12 以游客身份在本地开发服务器上打完 `GAME_OVER`，再由
  `localStorage['werewolf.replays.v1']` 导出；`schemaVersion` 均为 `1`。
- 人类发言已替换为 `[human speech omitted]`；座位名单只有 `seat/role/isHuman`。
  详见 `src/ai/__fixtures__/replays/README.md`。
- 捕获会话只有字体/头像/CAPTCHA 静态请求，`/.netlify/functions/` 请求为 0；整局
  不调用外部模型。

## 指标定义

| 指标 | 方向 | 定义 | 来源 |
| --- | --- | --- | --- |
| `illegalActionRate` | 越低越好 | 被合法性过滤拒绝的 AI 投票提案 / 全部有目标的 AI 投票提案 | `evaluation.ts` `runReplay` |
| `speechRepetitionRate` | 越低越好 | 归一化后重复的 AI 发言条数 / AI 发言条数（跨全局限定一次重复计数） | `evaluation.ts` |
| `infoLeakageRate` | 越低越好 | 命中任一 `LEAKAGE_RULES`（狼自曝/狼提队友/非预言家报验/女巫报药）的 AI 发言条数 / AI 发言条数 | `evaluation.ts` |
| `estimatedCostUSD` | 越低越好 | `(prompt tokens + response tokens) / 1000 × 0.001`；token 数按约 4 字符/token 估算，0.001 是名义代理费率，**不是价格** | `evaluation.ts` `estimateEvalCostUSD` + `benchmark.ts` |
| `voteRationalityScore` | 越高越好 | 目标落在投票者**同轮** `beliefSnapshots` 怀疑度前 2 的 AI 票数 / 有该轮快照的 AI 票数 | `benchmarkFixtures.ts` |
| `roleConsistencyScore` | 越高越好 | 未投给狼队友的 AI 票数 / 全部有目标的 AI 票数（非狼角色恒计入分子） | `benchmarkFixtures.ts` |

`targetId: null` 的弃票、人类条目、没有同轮快照的 AI 票不进入相应分母；分母为 0 时
分数定义为 1（无违例）。

## 实测结果（3 局）

| fixture | `roleConsistencyScore` | `illegalActionRate` | `voteRationalityScore` | `speechRepetitionRate` | `infoLeakageRate` | `estimatedCostUSD` |
| --- | --- | --- | --- | --- | --- | --- |
| `local-9p-001` | 1.000000（14/14） | 0.000000（0/14） | 1.000000（14/14） | 0.000000（0/16） | 0.000000（0/16） | 0.000564 |
| `local-9p-002` | 1.000000（12/12） | 0.000000（0/12） | 1.000000（12/12） | 0.000000（0/14） | 0.000000（0/14） | 0.000519 |
| `local-12p-001` | 0.972222（35/36） | 0.000000（0/36） | 0.972222（35/36） | 0.000000（0/39） | 0.000000（0/39） | 0.001536 |
| 合计 | — | 0/62 | 61/62 | 0/69 | 0/69 | 最高 0.001536 |

唯一非满分事件（可定位）：`local-12p-001` 第 1 轮，7 号（Werewolf）把票投给 8 号
（Werewolf 队友），`reason` 为“（低难度）随机选择”——这是 `selectAction` 在
Intermediate 档仍触发的随机化分支。它同时拉低 `roleConsistencyScore` 与
`voteRationalityScore` 各 1/36。样本中没有观察到重复发言或 info leakage。

> 本地发言库实际会输出中日混合文本（真实回放原样保留）。`LEAKAGE_RULES` 只匹配
> 中文模式，因此 `infoLeakageRate = 0` **不能**证明非中文文本不会泄露隐藏信息，
> 只能说明当前中文规则未命中。

## 阈值表与来源

阈值是**逐 fixture**的上/下界，定义在 `src/ai/benchmark.ts`；`benchmark.test.ts`
与 `--check` 同时执行。每个界都由“实测值 + 明确余量”得到：

| 具名常量 | 界 | 实测值 | 余量依据 |
| --- | --- | --- | --- |
| `MAX_ILLEGAL_ACTION_RATE` | ≤ 0.10 | 0/62 = 0.000000 | 最小 fixture 一次违规 = 1/12 ≈ 0.083，向上取 0.10 |
| `MAX_SPEECH_REPETITION_RATE` | ≤ 0.08 | 0/69 = 0.000000 | 最小 fixture 一次重复 = 1/14 ≈ 0.071，向上取 0.08 |
| `MAX_INFO_LEAKAGE_RATE` | ≤ 0.08 | 0/69 = 0.000000 | 同上（1/14 ≈ 0.071 → 0.08） |
| `MAX_ESTIMATED_COST_USD` | ≤ 0.004 | 最大 0.001536 USD | 约 2.6× 实测最大值，向上取整到 0.004 |
| `MIN_ROLE_CONSISTENCY_SCORE` | ≥ 0.90 | 最小 0.972222（35/36） | 余量 0.072；允许最小 fixture 出现一次“投队友”（11/12 ≈ 0.917） |
| `MIN_VOTE_RATIONALITY_SCORE` | ≥ 0.80 | 最小 0.972222（35/36） | 余量 0.172；允许 12 票中出现两次随机票（10/12 ≈ 0.833） |

阈值只约束当前 3 局样本 + 明确余量，**不是行业基准**。新增难度/板型样本会让某些
分数下降，届时应重测并记录新的余量，而不是为了通过测试放宽阈值。

## 转换输出与 `--check`

转换输出是 `GameBenchmarkResult[]` 的稳定 JSON：固定字段顺序、2 空格缩进、无
`createdAt`/绝对路径/随机量。`benchmarkFixtures.ts` 中的
`EXPECTED_BENCHMARK_RESULTS` 是 golden 表；`benchmark.test.ts` 与
`scripts/replay-to-benchmark.mjs --check` 都对照它。

`--check` 不通过时非零退出并打印逐字段差异或阈值违规；通过时输出：

```
local-12p-001 (12-standard): OK
local-9p-001 (9-standard): OK
local-9p-002 (9-standard): OK
benchmark check: PASS (3 fixtures, golden values and thresholds match, output stable)
```

`--check` 同时验证：≥3 份 fixture、9 人与 12 人板型各至少 1 份、两次转换字节一致、
输出不含绝对路径或时间戳。脚本用已存在的 `vite` devDependency（Vite 5 SSR module
loader）加载 `src/ai/**`：middleware-only，且 `server.ws: false` 关闭 Vite 的 HMR
WebSocket server，因此进程不监听任何端口；缓存只写系统临时目录，因此没有构建步骤，
也不需要 `stripTypeScriptTypes` / `module.register` 等 Node 22-only API，兼容项目
声明的 Node.js 20 基线。回归测试用 `net.Server.prototype.listen` 守卫断言 CLI
零监听。

## 复现命令

```bash
# 1) 转换（stdout 为 JSON；重定向到 /tmp，不写仓库）
node scripts/replay-to-benchmark.mjs src/ai/__fixtures__/replays/*.replay.json > /tmp/bench.json

# 2) 对照 golden 表与阈值（干净状态下必须通过）
node scripts/replay-to-benchmark.mjs --check

# 3) 定向测试
npx vitest run src/ai/benchmark.test.ts scripts/replay-to-benchmark.test.mjs
```

两次转换的字节一致性可用 `cmp` 复核：

```bash
node scripts/replay-to-benchmark.mjs src/ai/__fixtures__/replays/*.replay.json > /tmp/bench-a.json
node scripts/replay-to-benchmark.mjs src/ai/__fixtures__/replays/*.replay.json > /tmp/bench-b.json
cmp /tmp/bench-a.json /tmp/bench-b.json && echo STABLE
```

## 局限与未验证项

- **样本量小**：3 局本地对局（1 局 12 人、2 局 9 人），全部 `normal`、`zh`、游客；
  不能按难度、板型或角色组合下结论。
- **非生产用户数据**：不是线上用户行为、留存或满意度证据；也不代表外部 provider
  的质量（本地 Vite 全程短路外部模型）。
- **表达路径**：只用仓库内本地发言库回退；未验证 Gemini/百炼等外部表达质量。
- **指标覆盖**：回放不记录夜间行动、死亡时刻与系统日志，`illegalActionRate` 只覆盖
  日间投票；`roleConsistencyScore` 是“不投狼队友”的操作定义，不等于完整角色一致性。
- **泄漏检测规则**：`LEAKAGE_RULES` 四条均为中文正则；本地发言库会输出中日混合文本，
  非中文泄露可能漏检。0 只表示“当前规则未命中”。
- **成本口径**：`estimatedCostUSD` 用 mock provider + 名义费率 0.001 USD/1k tokens，
  只用于回归比较，不是真实账单；token 数为 4 字符/token 估算。
- **人类内容**：人类发言被省略、人类投票不进入评测，因此不能评估人类玩家行为。
- **golden 表是回归锁**：改动 runner/fixture/阈值时必须有意更新
  `EXPECTED_BENCHMARK_RESULTS` 并重新记录实测与余量。

## 给下游卡（H2-D / H2-F）的接口

- `src/ai/benchmarkFixtures.ts`
  - `loadReplayFixtures(dir?)`：读取并校验 `*.replay.json`（含脱敏守卫）。
  - `parseReplayFixture(value, label)` / `isReplayRecord(value)`：给新样本目录复用。
  - `loadBenchmarkFixtures(dir?)`：fixture → `GameBenchmarkResult`，带 `report`、
    `metrics`、`voteAgreement` 诊断字段。
  - `EXPECTED_BENCHMARK_RESULTS`：golden 表；`groupBenchmarkFixturesByDataVersion()`。
- `src/ai/benchmark.ts`
  - `GameBenchmarkResult` 契约、`benchmarkThresholdViolations()`、六个具名阈值常量、
    `BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD`。
- 脚本：`node scripts/replay-to-benchmark.mjs --check` 可直接作为 CI/验收门。
- `--fixtures <dir>` 只用于指向同一组样本的副本做复核；新增样本必须显式登记到
  `EXPECTED_BENCHMARK_RESULTS`，否则 `--check` 会报 golden 缺失。
