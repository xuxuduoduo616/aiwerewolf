# 难度校准报告（H2-D）

本文用**本地匿名回放**回答一个问题：`DIFFICULTY_CONFIGS` 的 easy / normal / hard
三档，在当前实现对局里是否真的产生可观察的行为差异。结论先行：**本卡不调参**；
三档之间的差值很小、方向不一致，每档只有 3 局、放逐事件分母只有 6–7 个，且
`DIFFICULTY_CONFIGS` 中只有 `actionAccuracy` 进入 AI 行为路径；现有数据不足以支持
任何参数修改，也不能把观察到的跨档差异归因于难度。

**本卡未修改任何难度参数。** `src/types.ts`、`src/ai/actionSelector.ts`、
`src/ai/beliefTracker.ts`、`src/gameEngine.ts`、`src/ai/evaluation.ts` 均为零 diff；
可核对：`git diff --stat -- src/types.ts src/ai/actionSelector.ts src/ai/beliefTracker.ts src/gameEngine.ts src/ai/evaluation.ts`（空）。

> r1 修复说明：初版 easy/hard 样本实际为 `language: "en"`，与 normal 的 `zh` 混用。
> 本轮已用 `zh` 环境**重捕 easy/hard 各 3 局**，9 局语言统一为 `zh`；结果表、样本表、
> 结论与局限均按新样本重算，并给脚本加了语言一致性告警。详见
> `memory/coordination/reports/H2-D.md` 的“r1 返工”段。

## 方法

```
src/ai/__fixtures__/calibration/<easy|normal|hard>/*.replay.json   (schemaVersion 1, H2-A)
  → benchmarkFixtures.parseReplayFixture()                （结构 + 脱敏守卫，只读复用 H2-C）
  → [逐局] 从 votes / players / beliefSnapshots 派生三个指标
  → [逐局] buildBenchmarkFromReplay() → evaluation.ts runReplay()（speech-repetition-rate）
  → [按难度] 分子/分母分别相加（pooled）→ Markdown 报告
```

固定口径：

- **分档依据**：`<difficulty>` 目录名必须与回放内的 `difficulty` 一致；不一致会被
  脚本列为 problem 并以非零码退出。
- **语言一致性**：脚本汇总每档的 `language` 并在样本表输出；9 局出现多于一种语言时，
  报告与结论会打印“样本语言不一致 … 不据此调参”。本批 9 局逐份核对均为 `zh`。
- **只回放 AI 行为**：AI 投票与 AI 发言进入指标；人类投票与人类发言不进入
  `ai-vote-hit-wolf-rate` / `speech-repetition-rate`。但**放逐票**按整张票表统计
  （含人类票），因为放逐是整桌结果。
- **聚合方式**：每档把 3 局的分子、分母**分别相加**再相除（pooled rate），不是
  把每局比率取平均。每格的 `(分子/分母)` 可直接复核。
- **确定性**：fixture 按文件名排序读取；无时间戳、无绝对路径、无随机数、无网络。
  同一批 fixture 两次运行输出字节一致（见“复现命令”）。
- **样本来源**：`normal` 3 局是 H2-C 样本的逐字节拷贝（`zh`）；`easy`/`hard` 各 3 局
  是 H2-D 本批捕获的本地真实对局（`zh`，2026-11-12 16:31–16:39 CST）。全部游客、
  9 人 2 局 + 12 人 1 局。**三档语言统一，但 normal 与 easy/hard 捕获批次不同**
  （normal 来自 H2-C 当日更早的 5173 批次）。详见
  `src/ai/__fixtures__/calibration/README.md`。

## 样本

| 难度 | n（局） | 板型 | 语言 | 终局 | 轮数合计 | AI 发言 | AI 投票 | 放逐 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| easy (Beginner) | 3 | 12-standard ×1, 9-standard ×2 | zh ×3 | WEREWOLVES ×3 | 12 | 75 | 68 | 6 |
| normal (Intermediate) | 3 | 12-standard ×1, 9-standard ×2 | zh ×3 | VILLAGERS ×1, WEREWOLVES ×2 | 9 | 69 | 62 | 6 |
| hard (Expert) | 3 | 12-standard ×1, 9-standard ×2 | zh ×3 | WEREWOLVES ×3 | 12 | 76 | 69 | 7 |

| fixture | 难度 | 板型 | 终局 | 轮数 | AI 发言 | AI 投票 | 狼被放逐/放逐 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `local-12p-easy-001` | easy | 12-standard | WEREWOLVES | 5 | 40 | 37 | 0/2 |
| `local-9p-easy-001` | easy | 9-standard | WEREWOLVES | 3 | 14 | 13 | 1/2 |
| `local-9p-easy-002` | easy | 9-standard | WEREWOLVES | 4 | 21 | 18 | 0/2 |
| `local-12p-001`（H2-C 拷贝） | normal | 12-standard | WEREWOLVES | 5 | 39 | 36 | 0/3 |
| `local-9p-001`（H2-C 拷贝） | normal | 9-standard | WEREWOLVES | 2 | 16 | 14 | 0/1 |
| `local-9p-002`（H2-C 拷贝） | normal | 9-standard | VILLAGERS | 2 | 14 | 12 | 1/2 |
| `local-12p-hard-001` | hard | 12-standard | WEREWOLVES | 5 | 40 | 37 | 0/2 |
| `local-9p-hard-001` | hard | 9-standard | WEREWOLVES | 3 | 15 | 14 | 0/2 |
| `local-9p-hard-002` | hard | 9-standard | WEREWOLVES | 4 | 21 | 18 | 2/3 |

## 指标定义与公式

| 指标 | 方向 | 公式（分子 / 分母） | 口径来源 |
| --- | --- | --- | --- |
| `wolf-exile-rate` | 越高说明放逐越常打中狼人（对狼队不利）；越低说明放逐更常落在好人 | 被放逐的玩家中狼人数量 / 被放逐的玩家数量 | 本卡从 `votes` 派生，规则对齐 `gameEngine.resolveVoteResult` |
| `ai-vote-hit-wolf-rate` | 越高越说明 AI 投票指向狼人 | AI 有目标且目标存在的票中，目标为 `Werewolf` 的票数 / AI 有目标且目标存在的票数 | 本卡从 `votes` + `players` 派生 |
| `belief-volatility` | 越高说明同局怀疑度变化越大 | 同一 AI actor 相邻两条 `beliefSnapshots` 中同一 target 的 `abs(score_now - score_before)` 之和 / 可比（actor, target, 相邻轮）观测数 | 本卡从 `beliefSnapshots` 派生 |
| `speech-repetition-rate` | 越低越好 | 归一化后重复的 AI 发言条数 / AI 发言条数（跨整局只记一次重复） | `benchmarkFixtures.buildBenchmarkFromReplay` → `evaluation.ts` `runReplay`（只读复用） |

放逐判定（`wolf-exile-rate` 的分母口径，对齐引擎规则）：

1. 每轮把该轮所有非弃票按 `targetId` 计数；
2. 票数**唯一最高**者被放逐；并列最高 → 本轮无人被放逐；
3. 白痴（Idiot）第一次成为唯一最高票时翻牌免死（记一次 reveal，不计入放逐），
   之后再次成为唯一最高票时正常放逐；
4. 弃票（`targetId: null`）不进入计数。

`belief-volatility` 的可比观测：只有同一 actor、同一 target 在相邻两条快照里都出现
才计入；目标在下一轮死亡/消失时不计；轮次间隔不折算，两轮之间只比较一条记录。

## 结果表（与 `node scripts/difficulty-calibration.mjs` 输出一致）

| 难度 | n | `wolf-exile-rate` | `ai-vote-hit-wolf-rate` | `belief-volatility` | `speech-repetition-rate` |
| --- | --- | --- | --- | --- | --- |
| easy (Beginner) | 3 | 0.166667 (1/6) | 0.352941 (24/68) | 0.022769 (7.400000/325) | 0.000000 (0/75) |
| normal (Intermediate) | 3 | 0.166667 (1/6) | 0.290323 (18/62) | 0.026691 (7.260000/272) | 0.000000 (0/69) |
| hard (Expert) | 3 | 0.285714 (2/7) | 0.275362 (19/69) | 0.027387 (8.490000/310) | 0.000000 (0/76) |

差值（`first − second`；正负只表示方向，不代表显著性）：

| 对比 | `wolf-exile-rate` | `ai-vote-hit-wolf-rate` | `belief-volatility` | `speech-repetition-rate` |
| --- | --- | --- | --- | --- |
| easy vs normal | 0.000000 | +0.062619 | -0.003922 | 0.000000 |
| normal vs hard | -0.119048 | +0.014960 | -0.000696 | 0.000000 |

逐局明细（顺序与脚本输出一致，按 fixture 文件名排序）：

| fixture | 难度 | 板型 | 终局 | 轮数 | AI 发言 | AI 投票 | 狼被放逐/放逐 | `belief-volatility` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `local-12p-easy-001` | easy | 12-standard | WEREWOLVES | 5 | 40 | 37 | 0/2 | 0.018157 (4.630000/255) |
| `local-9p-easy-001` | easy | 9-standard | WEREWOLVES | 3 | 14 | 13 | 1/2 | 0.035000 (0.910000/26) |
| `local-9p-easy-002` | easy | 9-standard | WEREWOLVES | 4 | 21 | 18 | 0/2 | 0.042273 (1.860000/44) |
| `local-12p-001` | normal | 12-standard | WEREWOLVES | 5 | 39 | 36 | 0/3 | 0.021964 (4.920000/224) |
| `local-9p-001` | normal | 9-standard | WEREWOLVES | 2 | 16 | 14 | 0/1 | 0.035000 (1.260000/36) |
| `local-9p-002` | normal | 9-standard | VILLAGERS | 2 | 14 | 12 | 1/2 | 0.090000 (1.080000/12) |
| `local-12p-hard-001` | hard | 12-standard | WEREWOLVES | 5 | 40 | 37 | 0/2 | 0.023080 (5.170000/224) |
| `local-9p-hard-001` | hard | 9-standard | WEREWOLVES | 3 | 15 | 14 | 0/2 | 0.031905 (1.340000/42) |
| `local-9p-hard-002` | hard | 9-standard | WEREWOLVES | 4 | 21 | 18 | 2/3 | 0.045000 (1.980000/44) |

以上数字与脚本当前输出一致。逐局的 `AI 投票` 是 `ai-vote-hit-wolf-rate` 的分母，
`狼被放逐/放逐` 是 `wolf-exile-rate` 的分子/分母。

## 样本量警告与统计诚实

- **每档 n=3**，等于本卡目标下限（目标每档 ≥3 局，最低每档 ≥1 局）。本批 9 局全部
  达到目标，因此没有触发“`样本不足（n<3）：仅方向性观察，不据此调参`”这条告警；
  但 3 局仍是**小样本**，所有结论只能是方向性的。
- **放逐分母极小**：每档只有 6–7 次放逐事件，单次放逐事件就能让
  `wolf-exile-rate` 变动约 0.14–0.17。easy 与 normal 的 1/6 完全相同；normal vs
  hard 的 −0.119 只相当于 1 次放逐事件的差别，不能当作难度效应。
- **观测不独立**：`belief-volatility` 的分母 272–325 是“actor × target × 轮次对”，
  同一局内高度相关；有效样本单位仍是 3 局，不是 300+。
- **胜负分布偏斜**：9 局中 8 局狼人胜（normal 有 1 局好人胜），终局与轮数结构接近，
  分档比较与“狼人是否优势”混杂。
- **`speech-repetition-rate` 全为 0**：只说明这 9 局内没有出现归一化后完全相同的
  AI 发言；`evaluation.ts` 的重复度口径是**单局内**去重，不度量跨局重复，也不度量
  语义相近。0 不代表表达质量高。
- **捕获批次不同**：normal 3 局来自 H2-C 当日 5173 批次，easy/hard 6 局来自 H2-D
  本次 4174 批次；语言已统一为 `zh`，但批次差异仍可能影响终局结构。
- **未做显著性检验**：本卡没有计算置信区间或 p 值；不给“显著/不显著”的结论，
  只报告分子/分母与差值。

## 结论：不调参

**本卡不修改 `DIFFICULTY_CONFIGS` 或任何规则参数，也不建议在本卡内调参。** 原因：

1. **差值很小且方向不一致**：easy vs normal 的 `wolf-exile-rate` 完全相同（1/6），
   `ai-vote-hit-wolf-rate` 高 0.0626，`belief-volatility` 低 0.0039；normal vs hard
   的 `wolf-exile-rate` 低 0.1190（相当于 1 次放逐事件），其余两个差值小于 0.015。
   没有“难度越高越强/越弱”的单调趋势，样本量也不足以做统计判断。
2. **难度参数中只有 `actionAccuracy` 进入 AI 行为路径**（只读核对）：
   `useGameState` 只把 `DIFFICULTY_CONFIGS[difficulty].actionAccuracy` 传给
   `setAIDifficulty`，再由 `actionSelector.selectAction` 用
   `Math.random() > actionAccuracy` 决定是否随机化；`speechQuality`、
   `wolfCoordination`、`mistakeRate` 只在 `src/types.ts` 定义/配置，除定义外没有
   消费引用。
3. **不能把观察到的跨档差异归因于难度**：三档样本虽已统一为 `zh`，但 normal 与
   easy/hard 来自不同捕获批次，且每档只有 3 局、放逐分母 6–7；当前数据不支持
   “难度导致差异”的因果结论。
4. **校准工具不等于调参许可**：即使将来观察到稳定差异，改 `src/types.ts` 也属于
   产品参数变更，需要另开卡、重新验收并经 owner 知情（见本卡 Owner decisions）。
   本卡只交付可复现的测量工具与报告。

### 下一步（均不涉及参数修改）

1. **扩样本**：每档 ≥30 局（同语言、同一捕获批次）、9/12 人板型各 ≥12 局，把每档
   放逐分母提高到 ≥30；若要比率区间，另开卡加 Wilson 置信区间或 bootstrap。
2. **补表达层指标**：当前四个指标只覆盖投票/放逐/信念/发言重复；若将来接线
   `speechQuality` / `wolfCoordination`，需要发言长度、角色一致性、信息泄露、
   跨局重复等指标，否则无法观察这些参数。
3. **评估“死参数”**：`speechQuality`、`wolfCoordination`、`mistakeRate` 是否应该被
   AI 路径真正消费，是产品决策；另开卡处理，不在本卡内改代码。
4. **扩大样本后重跑同一脚本**：脚本按目录分档，新增样本不需要改代码；只需同步更新
   本文结果表与 `src/ai/__fixtures__/calibration/README.md`。

## 复现命令

```bash
# 1) 生成报告（Markdown 同时打印到 stdout 并写入 /tmp，不写仓库）
node scripts/difficulty-calibration.mjs --fixtures src/ai/__fixtures__/calibration --out /tmp/calib.md
head -40 /tmp/calib.md

# 2) 确定性：两次运行字节一致
node scripts/difficulty-calibration.mjs --fixtures src/ai/__fixtures__/calibration --out /tmp/calib-a.md
node scripts/difficulty-calibration.mjs --fixtures src/ai/__fixtures__/calibration --out /tmp/calib-b.md
cmp /tmp/calib-a.md /tmp/calib-b.md && echo STABLE

# 3) 脚本单测（指标、n<3 警告、混语言告警、输出稳定、缺档失败）
npx vitest run scripts/difficulty-calibration.test.mjs

# 4) 语言一致性核对（应全部打印 zh）
for f in src/ai/__fixtures__/calibration/*/*.replay.json; do
  printf '%s: ' "$f"
  node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).language)' "$f"
done
```

脚本使用已存在的 `vite` devDependency（Vite 5 SSR module loader）加载
`src/ai/**`；middleware-only、`server.ws: false`，不监听端口、不写仓库缓存
（缓存只写系统临时目录）。整条管线零网络、零外部模型；`grep -nE "fetch\(|XMLHttpRequest|sendBeacon|https?://" scripts/difficulty-calibration.mjs` 为空。

## 局限与未验证项

- **非生产数据**：9 局都是本地无密钥、无外部模型的开发环境对局（其中 6 局 easy/hard
  的人类操作由捕获脚本代打：发言 `Pass`、票投第一个可选存活座位、夜间优先 `PASS`），
  不能推断线上玩家行为或外部 provider 质量。
- **捕获批次不同**：normal 3 局来自 H2-C 当日更早的 5173 批次，easy/hard 6 局来自
  H2-D 本次 4174 批次。语言已统一为 `zh`，但批次可能影响终局结构；本卡不把跨档
  差异归因于难度。
- **放逐事件是派生值**：回放 schema 没有显式“谁被放逐”字段，也没有 `isRevealed`
  快照；本卡的放逐判定是对 `resolveVoteResult` + 白痴规则的重建。它与引擎在正常
  对局中一致，但回放本身不记录终局日志，无法逐局对账。
- **不重放死亡/存活**：指标直接使用记录的票表，不重新模拟谁在何时死亡；如果
  fixture 与真实票表不一致（例如把已死亡座位写进 `votes`），本卡不会发现。
- **`ai-vote-hit-wolf-rate` 不分角色**：狼人投队友也计入“命中狼人”，所以它不是
  “好人准确率”，只看 AI 投票指向狼人的比例。
- **`belief-volatility` 受快照轮次影响**：只比较相邻记录轮；若某轮没有快照（tracker
  未初始化），比较会跨过该轮，间隔不折算。
- **人类行为被省略**：人类发言是占位符、人类投票不进入 AI 命中率；人类仍计入放逐
  票表，因此 `wolf-exile-rate` 包含人类行为影响。
- **语言覆盖有限**：本批只覆盖 `zh`；`en` 表达层（本地发言库的英文回退）没有进入
  本校准，不能推断英文环境的三档行为。
- **未验证 Node 20 实机**：与 H2-C 相同，脚本使用 Vite 5 SSR loader，理论上兼容项目
  的 Node 20 基线；本轮只在本机 Node v22.23.1 上运行，未在真实 Node 20 二进制复跑。
- **脚本输出不含时间戳/路径**：报告只描述样本集合，不记录捕获日期；捕获日期与批次
  见 `src/ai/__fixtures__/calibration/README.md` 与
  `memory/coordination/reports/H2-D.md`。

---

## P2B 确定性离线仿真校准报告（n=30 局/档，9人+12人）

在保留上方 H2-D 历史基线报告不变的前提下，P2B 完成了三项工程补齐与离线实测：
1. 将 `DIFFICULTY_CONFIGS` 中长期未消费的 `wolfCoordination`（`0.30 / 0.65 / 0.90`）与 `mistakeRate`（`0.55 / 0.25 / 0.08`）接入 `actionSelector.selectAction` 与 `aiOrchestrator.setAIDifficulty` / `setAIExpressionModel`（未修改 `DIFFICULTY_CONFIGS` 数值）。
2. 通过 `node scripts/difficulty-calibration.mjs --simulate 30` 对三档难度运行**配对同种子确定性离线仿真**（每档 30 局 = 15 局 `9-standard` + 15 局 `12-standard`，共 90 局，基址 `baseSeed=20261124`），完整走过真实 `BeliefTracker`、`selectAction` 与 `gameEngine`。
3. 新增默认关闭（`DEFAULT_LLM_EXTRACTOR_ENABLED = false`）的可选结构化发言抽取器 `src/ai/speechExtractorLLM.ts`，并在 14 条中英双语样本上完成与 P1A 规则解析器的离线 A/B 对比与回退安全验证。

### 样本规模与板型覆盖

| 维度 | H2-D 历史基线 | P2B 离线仿真 |
| --- | --- | --- |
| 每档局数 | 3 局/档（合计 9 局） | **30 局/档（合计 90 局）** |
| 板型配比 | 9p ×2 + 12p ×1 / 档 | **9-standard ×15 + 12-standard ×15 / 档（50%/50%）** |
| 跨档可比性 | normal 与 easy/hard 来自不同捕获批次 | **三档共享完全相同的 30 个随机种子局（配对控制）** |
| 投票口径 | `ai-vote-hit-wolf-rate` 未拆阵营 | **拆分好人命中率、狼队护队友率、狼队票型集中度** |

### P2B 接线后指标（`node scripts/difficulty-calibration.mjs --simulate 30` 实测）

| 难度 | n（9p/12p） | `goodAiVoteHitWolfRate` | `wolfTeammateProtectionRate` | `wolfVoteConcentration` | `illegalActionRate` | `unauthorizedReadRate` | `fallbackRate` | 决策延迟 p50/p95 (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| easy (Beginner) | 30 (15/15) | **53.40%** (306/573) | **89.32%** (276/309) | **50.56%** (105 rounds) | 0.000000 (0/1185) | 0.000000 (0/1185) | 0.000000 (0/1185) | 0.002 / 0.033 |
| normal (Intermediate) | 30 (15/15) | **58.67%** (335/571) | **96.03%** (290/302) | **62.95%** (101 rounds) | 0.000000 (0/1178) | 0.000000 (0/1178) | 0.000000 (0/1178) | 0.002 / 0.014 |
| hard (Expert) | 30 (15/15) | **63.40%** (369/582) | **99.38%** (320/322) | **87.77%** (109 rounds) | 0.000000 (0/1197) | 0.000000 (0/1197) | 0.000000 (0/1197) | 0.002 / 0.014 |

单调性检验：
- `goodAiVoteHitWolfRate`：`hard (63.40%) > normal (58.67%) > easy (53.40%)` — **PASS**（修复了 H2-D 3 局样本中 `hard < easy` 的倒挂现象）。
- `wolfTeammateProtectionRate`：`hard (99.38%) > normal (96.03%) > easy (89.32%)` — **PASS**。
- `wolfVoteConcentration`：`hard (87.77%) > normal (62.95%) > easy (50.56%)` — **PASS**。
- 安全与合法性：全部 90 局合计 3,560 次 AI 决策中，非法行动率 `0/3560`、越权读信息率 `0/3560`、未初始化回退率 `0/3560`。

### Before vs After 对比（同 30 种子基线未接线 vs P2B 接线后）

| 难度 | H2-D 3局旧口径 `aiVoteHitWolf` | 同种子基线 `goodHit` | P2B `goodHit` | 同种子基线 `wolfProtect` | P2B `wolfProtect` | 同种子基线 `wolfConc` | P2B `wolfConc` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| easy | 35.29% (24/68) | 54.50% | **53.40%** | 79.38% | **89.32%** | 55.90% | **50.56%** |
| normal | 29.03% (18/62) | 52.49% | **58.67%** | 77.86% | **96.03%** | 69.17% | **62.95%** |
| hard | 27.54% (19/69) | 61.82% | **63.40%** | 75.71% | **99.38%** | 78.92% | **87.77%** |

角色动作分布（P2B 接线后 30 局/档合计）：

| 难度 | KILL | CHECK | SAVE (ACT/HOLD) | POISON (ACT/HOLD) | SHOOT | VOTE |
| --- | --- | --- | --- | --- | --- | --- |
| easy | 136 | 70 | 30/0 | 19/29 | 19 | 882 |
| normal | 129 | 59 | 30/0 | 12/55 | 20 | 873 |
| hard | 133 | 54 | 30/0 | 3/58 | 15 | 904 |

### 典型回放案例走查（3 例）

1. **案例 1 — 9人局 Expert 档（`seed=20261124`，胜方 `VILLAGERS`，4 轮）**
   - 指标：`goodAiVoteHitWolfRate=0.833 (15/18)`，`wolfTeammateProtectionRate=1.000`，`wolfVoteConcentration=0.667`。
   - 关键转折：
     - **R1 夜间/发言**：真预言家 `1号` 验出 `9号(Werewolf)` 查杀并公开报验；悍跳狼 `3号` 反跳预言家给 `1号` 发假查杀；女巫 `7号` 顺着公开发言指认 `9号`。
     - **R1 投票**：6 名好人（`1/2/5/6/7/8`）全部集火投出 `9号(Werewolf)`；3 名狼人（`3/4/9`）通过 `wolfCoordination=0.90` 触发确定性共识冲票 `1号`（`狼队协同冲票 1号`），最终 `9号` 出局。
     - **R2 投票**：真预言家 `1号` 在夜里验出 `3号` 查杀后倒牌；剩余好人借助公开票型区块推理（识别 R1 与被放逐狼人同票冲 `1号` 的 `3号/4号`），把票转向狼人阵营，最终锁定好人胜利。

2. **案例 2 — 12人局 Expert 档（`seed=20410719`，胜方 `WEREWOLVES`，5 轮）**
   - 指标：`goodAiVoteHitWolfRate=0.455 (10/22)`，`wolfTeammateProtectionRate=1.000`，`wolfVoteConcentration=0.833`。
   - 关键转折：
     - **R1 夜间/发言**：女巫 `3号` 救起 `8号(Seer)` 并报银水；悍跳狼 `5号` 给 `1号(Villager)` 发假查杀；真预言家 `8号` 发 `4号` 金水并点破 `5号` 对跳假预言家。
     - **R1 投票**：4 名狼人（`5/6/10/12`）全部协同冲票 `1号`（`狼队协同冲票 1号`），与被误导的部分好人合力先推出 `1号(Villager)`。
     - **R2 转向**：`8号` 夜验 `5号(Werewolf)` 查杀且女巫 `3号` 点出 `5号` 可疑后，5 名好人（`2/3/4/7/9`）立刻改票集火 `5号` 将其放逐；狼队 4 人同步把协同目标切换为 `9号`（`狼队协同冲票 9号`），展示跨轮目标切换与高集中度。

3. **案例 3 — 同局配对对比（9人局 `seed=20271097`，`easy` vs `hard`）**
   - 同一发牌局下，真预言家 `4号` 首夜均验出 `6号(Werewolf)` 查杀，悍跳狼 `1号` 均发 `2号` 金水。
   - **Beginner (`easy`)**：`goodAiVoteHitWolfRate=66.7%`、`wolfVoteConcentration=66.7%`，因 `actionAccuracy=0.45 / mistakeRate=0.55` 导致好人与狼队均出现明显分散与随机失误。
   - **Expert (`hard`)**：`goodAiVoteHitWolfRate=76.5%`（`+9.8pp`）、`wolfVoteConcentration=75.0%`（`+8.3pp`），在完全相同的局面起点上同时呈现更高的好人逻辑执行度与更紧密的狼队协同。

### 可选 LLM 结构化证据抽取器离线 A/B 评估（默认 OFF）

`src/ai/speechExtractorLLM.ts` 默认关闭（`DEFAULT_LLM_EXTRACTOR_ENABLED = false`），仅作为离线评估与未来可选扩展保留；所有决策权仍 100% 归属确定性 TypeScript 引擎。在 14 条中英双语标注样本（覆盖直白发言、否定反转、引用/假设抑制、反讽与隐晦表达）上，对比 P1A 规则解析器与离线 Mock 结构化抽取器：

| 方案 | TP / FP / FN | Precision | Recall | F1 | Fallback Rate | 平均延迟 (ms) | 单局估算成本 (24 发言/局) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1A 规则解析器 (`parseSpeechEvidence`) | 11 / 2 / 7 | 0.846154 | 0.611111 | **0.709677** | 0.000000 | 0.463 | \$0.000000 |
| 可选 LLM 结构化抽取器 (离线 Mock) | 18 / 0 / 0 | 1.000000 | 1.000000 | **1.000000** | 0.000000 (0/14) | 0.042 (Mock) | **\$0.001752**（1,023 tokens / 14 条） |

准入门槛判定（`LLM_EXTRACTOR_ADOPTION_GATE`）：
- `f1Delta >= 0.10`：实测 `+0.290323`（PASS，主要增益来自反讽与隐晦表达，规则解析器在直白/否定/引用场景表现稳健）。
- `fallbackRate < 0.05`：离线 Mock 实测 `0.000000`（PASS）；异常注入（非法 JSON、越界/非法极性 schema、provider 抛错、`timeoutMs` 超时）下 100% 安全回退至 P1A `parseSpeechEvidence`，零未捕获异常。
- `estimatedCostPerMatchUSD <= $0.002`：按 `BENCHMARK_COST_PROXY_PER_1K_TOKENS_USD = 0.001` 与 24 条发言/局估算为 `\$0.001752`（PASS）。
- **默认策略维持 OFF**：离线 Mock 的 `F1=1.0` 与 `0.042ms` 延迟代表架构上界，不代表真实远程模型在生产网络的延迟与 JSON 稳定率；在未完成真实线上模型采样实测前保持默认关闭。

### P2B 复现命令与局限

```bash
# 1) 运行 30 局/档（90 局，9p+12p）确定性离线仿真校准
node scripts/difficulty-calibration.mjs --simulate 30

# 2) 运行 P2B 专项单测与 H2-D 既有校准单测
npx vitest run src/ai/calibration.p2b.test.ts scripts/difficulty-calibration.test.mjs
```

局限说明：
- **离线合成发言局限**：`--simulate 30` 使用严格座位可见的确定性中文模板发言驱动信念演化，不包含真实人类玩家的复杂语义、情绪博弈或远程 LLM 表达层波动；因此不能将其直接等同于生产环境真人对局胜率。
- **LLM 抽取器为离线 Mock 评估**：`evaluateExtractorAB` 使用确定性离线 Mock 响应验证 schema 校验、回退安全、F1 潜在提升空间与 token 成本模型，未调用真实外部模型，真实网络延迟（预计 300–1200ms）与实网 fallback 率仍属 `未验证`。
- **保持既有参数不变**：P2B 未改动 `DIFFICULTY_CONFIGS` 原始配置数值与冻结规则文件，仅让既有 `wolfCoordination` / `mistakeRate` 真正生效。
