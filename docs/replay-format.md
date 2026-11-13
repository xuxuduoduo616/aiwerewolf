# Replay format (`schemaVersion: 1`)

本地回放数据层由 `H2-A` 实现：一局结束后生成一份结构化 JSON，保存于浏览器
`localStorage`，供界面（`H2-B`）与回放/复盘（`H2-C`/`H2-D`）读取。它不写
Supabase、不发网络请求、不新增数据库表或迁移。

- 代码入口：`src/replay/index.ts`
- 类型：`src/replay/replayTypes.ts`（`ReplayRecord` 等）
- 构建/录制：`src/replay/replayRecorder.ts`（`buildReplay`、`createReplayRecorder`）
- 存储/导出：`src/replay/replayStore.ts`（`saveReplay`、`listReplays`、`loadReplay`、`exportReplay`、`clearReplays`）
- 采集点：`src/hooks/useGameState.ts`（只新增记录调用，不改阶段机/计时/投票/AI 顺序）

## 版本策略

- `schemaVersion` 是整数常量，当前为 `1`（`REPLAY_SCHEMA_VERSION`）。
- 新增**可选**字段仍属于同一版本；字段改名、删除、语义变化或必填化必须把常量加一。
- 读取端只接受当前版本；版本不匹配的记录会被忽略，不会被误读成新结构。
- `localStorage` 键名带主版本号：`werewolf.replays.v1`。更换不兼容结构时同时提升
  键名与 `schemaVersion`，旧键留给后续手动清理，不自动迁移。
- 升级时同步更新本文件的字段表与示例，并在 `src/replay/replayRecorder.test.ts` /
  `src/replay/replayStore.test.ts` 更新版本断言。

## 字段表

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `schemaVersion` | `1` | 回放结构版本。 |
| `gameId` | `string` | 本地随机局 id（UUID 或 `replay-...`），仅用于去重/索引，不是账号 id。 |
| `createdAt` | ISO `string` | 终局写盘时间。 |
| `boardId` | `'9-standard' \| '12-standard'` | 板型。 |
| `difficulty` | `'easy' \| 'normal' \| 'hard'` | 开局难度。 |
| `language` | `'zh' \| 'en'` | 本局 AI 表达语言。 |
| `isGuest` | `boolean` | 游客（`true`）或登录用户（`false`）；不含账号信息。 |
| `players` | `ReplayPlayerSeat[]` | 座位名单，仅 `{ seat, role, isHuman }`；**没有玩家名**。 |
| `phases` | `ReplayPhaseEntry[]` | 有序阶段序列 `{ phase, round }`，从 `NIGHT_START:0` 到 `GAME_OVER`。 |
| `speeches` | `ReplaySpeech[]` | 每次公开发言 `{ round, phase, speakerId, text }`，人类发言为原文。 |
| `votes` | `ReplayVote[]` | 每轮每名投票者一条 `{ round, voterId, targetId, reason? }`；弃票/失票为 `targetId: null`；AI 的 `reason` 来自 `generateAIAction`，人类没有 `reason` 键。 |
| `beliefSnapshots` | `ReplayBeliefSnapshot[]` | 每轮存活 AI 座位的怀疑度快照 `{ round, actorId, scores: [{ targetId, score }] }`。 |
| `wolfChat` | `ReplayWolfChatEntry[]` | 狼队夜聊 `{ round, speakerId, message }`。 |
| `checks` | `ReplayCheck[]` | 预言家查验链 `{ round, actorId, targetId, isGood }`，AI 与人类两条路径都记录。 |
| `outcome` | `{ winner, rounds }` | `winner: 'VILLAGERS' \| 'WEREWOLVES'`；`rounds` 为终局轮数（至少 1）。 |

不变量：

- 顶层键序固定（见示例与 `buildReplay` 的对象字面量顺序），导出结果不含
  `undefined` 字段。
- 数组按记录顺序输出；`beliefSnapshots` 按 `round`、`actorId` 升序，`scores`
  按分数降序、同分按 `targetId` 升序。
- 所有 `score` 都被钳制在 `[0,1]`；非法条目在构建/读取时被丢弃，而不是写入。

## 采集点与口径

| 数据 | 写入时机 | 位置 |
| --- | --- | --- |
| `phases` | `phase`/`roundCount` 变化后的只读 effect（去重连续重复项） | `src/hooks/useGameState.ts`（`recordPhase`） |
| AI `speeches` | AI 日间发言日志提交后 | `handleDiscussion` 内（`recordSpeech`） |
| 人类 `speeches` | 人类提交发言后 | `handleHumanSpeechSubmit` 内（`recordSpeech`） |
| `votes` + AI `reason` | 本轮投票结算时（`settleVote`，放逐结算前） | `finishVote`/`settleVote`（`recordVote`） |
| `checks`（AI） | AI 预言家查验提交后 | `handleSeerPhase` 内（`recordCheck`） |
| `checks`（人类） | 人类预言家点选目标后 | `handlePlayerAction` 的 `NIGHT_SEER` 分支（`recordCheck`） |
| `wolfChat` | 狼队夜聊提交后 | `handleWerewolfPhase` 的 `runWhenActive` 内（`recordWolfChat`） |
| `beliefSnapshots` | 每轮投票结算时；若该轮在夜晚/猎人枪后终局，则在 `GAME_OVER` 补一次 | `settleVote` 与终局 effect（`recordBeliefSnapshots`） |

怀疑度快照口径：

- 只读调用冻结的 `globalBeliefTracker.snapshot(actorId)`，不 `init`、不更新、不回写。
- 仅记录**当时存活**的非人类座位。
- `scores` 只保留**当时存活**的其他座位，因此长度恒为 `存活人数 - 1`，且
  `score ∈ [0,1]`。
- 若 tracker 尚未初始化（没有可读信念），该轮不写空快照。

## 落盘时机：只在 `GAME_OVER` 一次

- 录制器只在内存中累积；终局前不调用 `saveReplay`，`localStorage` 不出现
  `werewolf.replays.v1`。
- `winner` 非空且 `phase === GAME_OVER` 时，一个 effect 取快照、`finalize()` 并调用
  `saveReplay(record)`。
- 幂等三重保障：effect 的 `replaySavedRef`、录制器的 one-shot `finalize()`、
  `saveReplay` 按 `gameId` upsert。
- 中途退出（未终局）不会产生回放。

## 存储与降级

- 键：`werewolf.replays.v1`，值为 `{ "version": 1, "replays": [...] }`。
- 只保留最近 **5** 局（`MAX_RETAINED_REPLAYS`），新记录在前，超出部分从尾部丢弃。
- 以下情况自动降级为“本会话内存模式”，不抛错、不中断游戏：
  - `localStorage` 不存在或访问抛错；
  - 读取到的 JSON 损坏；
  - 写入超容量（如 `QuotaExceededError`）。
- 降级后读写都以内存为准，避免重新读回不含最新一局的旧存储；`clearReplays()`
  会清空内存并复位降级标记。
- 读取时会做运行时校验并剥离未知字段（包括可能混入的名字/邮箱），非法记录被忽略。

## 导出 API

```ts
import {
  listReplays,   // (): ReplayRecord[]        最新在前
  loadReplay,    // (id: string): ReplayRecord | null
  exportReplay,  // (id: string): string | null 稳定 JSON（2 空格缩进）
  clearReplays,  // (): void
  saveReplay,    // (record: ReplayRecord): boolean（仅内部/测试使用）
  type ReplayRecord,
} from '../replay';
```

`exportReplay` 只做 `JSON.stringify`：键序固定、无 `undefined`、可被 `JSON.parse`
回读为等价结构；不写文件、不发网络请求。

## 示例 JSON

以下由 `buildReplay` 在测试夹具（9 人标准场，第 1 轮终局）上生成，可直接粘贴到
`JSON.parse` 校验。为控制篇幅，`speeches`、`votes`、`beliefSnapshots` 只展示了
部分条目；真实记录的这三个数组分别覆盖每一次发言、每一张票、每一轮每个存活
AI 座位（`scores.length = 存活人数 - 1`）。

```json
{
  "schemaVersion": 1,
  "gameId": "b4c1f0d6-5d2a-4c3e-9b1f-6a0d8f7e2c11",
  "createdAt": "2026-11-12T09:30:00.000Z",
  "boardId": "9-standard",
  "difficulty": "normal",
  "language": "en",
  "isGuest": true,
  "players": [
    { "seat": 1, "role": "Villager", "isHuman": true },
    { "seat": 2, "role": "Werewolf", "isHuman": false },
    { "seat": 3, "role": "Seer", "isHuman": false },
    { "seat": 4, "role": "Witch", "isHuman": false },
    { "seat": 5, "role": "Villager", "isHuman": false },
    { "seat": 6, "role": "Hunter", "isHuman": false },
    { "seat": 7, "role": "Werewolf", "isHuman": false },
    { "seat": 8, "role": "Villager", "isHuman": false },
    { "seat": 9, "role": "Werewolf", "isHuman": false }
  ],
  "phases": [
    { "phase": "NIGHT_START", "round": 0 },
    { "phase": "NIGHT_WEREWOLVES", "round": 1 },
    { "phase": "NIGHT_SEER", "round": 1 },
    { "phase": "NIGHT_WITCH", "round": 1 },
    { "phase": "DAY_ANNOUNCE", "round": 1 },
    { "phase": "DAY_HUNTER_CHECK", "round": 1 },
    { "phase": "DAY_DISCUSSION", "round": 1 },
    { "phase": "DAY_VOTING", "round": 1 },
    { "phase": "GAME_OVER", "round": 1 }
  ],
  "speeches": [
    {
      "round": 1,
      "phase": "DAY_DISCUSSION",
      "speakerId": 1,
      "text": "Player 2 spoke first last round and avoided naming a target. I am voting there."
    },
    {
      "round": 1,
      "phase": "DAY_DISCUSSION",
      "speakerId": 2,
      "text": "Player 1 is reading too much into one speech, but I will answer questions."
    }
  ],
  "votes": [
    { "round": 1, "voterId": 1, "targetId": 2 },
    { "round": 1, "voterId": 2, "targetId": 1, "reason": "投可疑度最高的 1号" },
    { "round": 1, "voterId": 3, "targetId": 2, "reason": "投可疑度最高的 2号" }
  ],
  "beliefSnapshots": [
    {
      "round": 1,
      "actorId": 2,
      "scores": [
        { "targetId": 1, "score": 0.9 },
        { "targetId": 3, "score": 0.83 },
        { "targetId": 4, "score": 0.76 },
        { "targetId": 5, "score": 0.69 },
        { "targetId": 6, "score": 0.62 },
        { "targetId": 7, "score": 0.55 },
        { "targetId": 8, "score": 0.48 },
        { "targetId": 9, "score": 0.41 }
      ]
    },
    {
      "round": 1,
      "actorId": 3,
      "scores": [
        { "targetId": 1, "score": 0.9 },
        { "targetId": 2, "score": 0.83 },
        { "targetId": 4, "score": 0.76 },
        { "targetId": 5, "score": 0.69 },
        { "targetId": 6, "score": 0.62 },
        { "targetId": 7, "score": 0.55 },
        { "targetId": 8, "score": 0.48 },
        { "targetId": 9, "score": 0.41 }
      ]
    }
  ],
  "wolfChat": [
    {
      "round": 1,
      "speakerId": 2,
      "message": "Player 3 is the seer, push Player 1 instead."
    }
  ],
  "checks": [
    { "round": 1, "actorId": 3, "targetId": 2, "isGood": false }
  ],
  "outcome": { "winner": "VILLAGERS", "rounds": 1 }
}
```

## 从浏览器取一份导出

1. 完成一局到 `GAME_OVER`（中途退出不会产生回放）。
2. 打开开发者工具 → Application → Local Storage → 站点 origin → 键
   `werewolf.replays.v1`。
3. 在 Console 执行下面任一命令（`copy` 是 Chrome/Edge DevTools 的辅助函数）：

```js
// 最近一局：与 exportReplay(id) 相同的 JSON 文本
copy(JSON.stringify(JSON.parse(localStorage.getItem('werewolf.replays.v1')).replays[0], null, 2))
```

如果站点运行在无 `localStorage` 的隐私模式，游戏照常进行，但回放只存在于该页面的
内存中，无法跨刷新导出；这是设计上的降级，不是错误。

## 给下游卡（H2-B / H2-C / H2-D）的接口

- **H2-B（UI）**：用 `listReplays()` 渲染列表（最新在前），`loadReplay(id)` 取详情；
  列表项可显示 `createdAt`、`boardId`、`outcome.winner`、`outcome.rounds`。不要
  期望玩家名：人类只以 `seat` + `isHuman: true` 表示。
- **H2-C（回放播放器/分析）**：直接消费 `ReplayRecord`；`phases` 提供顺序，
  `speeches`/`votes`/`checks`/`wolfChat` 按 `round` 对齐；`beliefSnapshots` 的
  `scores` 是该轮存活座位的相对怀疑度，不要与 `Player.suspicionMap` 混用。
- **H2-D（导出/分享）**：调用 `exportReplay(id)` 得到稳定字符串；若返回 `null`
  说明该局未保存或存储被清空，界面应给出空状态而不是抛错。
- 所有 API 都不做网络访问。跨设备读取需要远端存储，属于 owner 决策，不在本卡范围。

## 隐私与安全

- 不写玩家名、邮箱、token、`userId`、Supabase session 或任何凭据；人类只以
  `seat` + `isHuman: true` 表示。
- 发言文本是玩家/AI 的公开内容，按原文保存；其中可能自然出现座位号（如
  `Player 3`），这是游戏内容，不是身份元数据。
- `src/replay/**` 不含 `fetch`/`XMLHttpRequest`/`sendBeacon`/URL，也不引入 Supabase
  客户端或新依赖。
- **本卡没有新增 Supabase 表、迁移、RLS 策略或远程写入路径。**

## 已知限制

- 回放是浏览器本地数据：只保留最近 5 局，清站点数据即丢失；不跨设备、不跨浏览器
  profile。
- 当前不记录完整系统日志、夜间行动明细（刀/救/毒）与 UI 事件；这些未在 post-MVP 范围。
- 若 `globalBeliefTracker` 因异常路径从未初始化，对应轮次不会写快照（不会写空数组
  冒充完整数据）。
- 存储降级状态在同一页面会话内是粘性的：一旦写入失败，本次会话后续回放只保留在
  内存中，直到 `clearReplays()` 或刷新页面。
