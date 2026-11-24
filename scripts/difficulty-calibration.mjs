#!/usr/bin/env node
// --- START OF FILE scripts/difficulty-calibration.mjs ---
//
// H2-D: compare the three difficulty tiers with local anonymous replay fixtures.
//
//   node scripts/difficulty-calibration.mjs --fixtures src/ai/__fixtures__/calibration --out /tmp/calib.md
//
// Reads `<fixtures>/<easy|normal|hard>/*.replay.json`, computes four pooled
// metrics per difficulty, and renders a deterministic Markdown report with
// numerator/denominator, per-game sample counts, the easy-vs-normal and
// normal-vs-hard deltas, and an explicit "do not tune parameters yet"
// conclusion.
//
// Zero network and zero external model calls: the only speech-repetition
// source is `evaluation.ts` through `benchmarkFixtures.buildBenchmarkFromReplay`,
// and every other metric is derived from the replay JSON itself. Same fixture
// bytes → same report bytes: no timestamps, no absolute paths, no randomness.
//
// The script imports the TypeScript benchmark modules through Vite's SSR module
// loader (`vite` is already a devDependency and Vite 5 supports the project's
// Node.js 20 baseline). The server is middleware-only with `server.ws: false`,
// so the process never listens on a port; the loader only runs from the CLI
// entry point, which keeps importing this file from a Vitest test side-effect
// free.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

/** Difficulty tiers, in report order. */
export const DIFFICULTIES = ['easy', 'normal', 'hard'];

/** Human-readable tier labels (the lobby labels from `src/types.ts`). */
export const DIFFICULTY_LABELS = {
  easy: 'Beginner',
  normal: 'Intermediate',
  hard: 'Expert',
};

/** Suffix of a replay fixture file. */
export const FIXTURE_FILE_SUFFIX = '.replay.json';

/** Default fixture root, relative to the repository root. */
export const DEFAULT_FIXTURES_DIR = 'src/ai/__fixtures__/calibration';

/** The card's target sample size per difficulty. Below it the report warns. */
export const TARGET_GAMES_PER_DIFFICULTY = 3;

/** Exact warning required by the task card when any tier has fewer than 3 games. */
export const SAMPLE_INSUFFICIENT_WARNING = '样本不足（n<3）：仅方向性观察，不据此调参';

/** The four calibration metrics, in report order. */
export const CALIBRATION_METRICS = [
  'wolfExileRate',
  'aiVoteHitWolfRate',
  'beliefVolatility',
  'speechRepetitionRate',
];

export const METRIC_LABELS = {
  wolfExileRate: 'wolf-exile-rate',
  aiVoteHitWolfRate: 'ai-vote-hit-wolf-rate',
  beliefVolatility: 'belief-volatility',
  speechRepetitionRate: 'speech-repetition-rate',
};

/** Metric definitions shown in the generated report. */
export const METRIC_DEFINITIONS = {
  wolfExileRate: {
    direction: '越高说明放逐越常打中狼人（对狼队不利）；越低说明放逐更常落在好人',
    definition: '被放逐（票数唯一最高）的玩家中狼人数量 / 被放逐的玩家数量',
  },
  aiVoteHitWolfRate: {
    direction: '越高越说明 AI 投票指向狼人',
    definition: 'AI 投给狼人的票数 / AI 有目标的票数',
  },
  beliefVolatility: {
    direction: '越高说明同局怀疑度变化越大',
    definition: '同一 actor 相邻两轮快照中同一 target 的绝对分数变化之和 / 可比 (actor, target, 相邻轮) 观测数',
  },
  speechRepetitionRate: {
    direction: '越低越好',
    definition: '归一化后重复的 AI 发言条数 / AI 发言条数（复用 evaluation.ts 口径）',
  },
};

const WEREWOLF_ROLE = 'Werewolf';
const IDIOT_ROLE = 'Idiot';

const toSafeNumber = value => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

const rateOf = (numerator, denominator) => {
  const safeDenominator = toSafeNumber(denominator);
  return safeDenominator === 0 ? null : toSafeNumber(numerator) / safeDenominator;
};

/**
 * Plurality target of one round, mirroring `resolveVoteResult` in
 * `src/gameEngine.ts`: the strict maximum wins; a tie means nobody is exiled.
 * Abstentions (`targetId: null`) do not enter the tally.
 */
export const pluralityTargetOfRound = (record, round) => {
  const counts = new Map();
  for (const vote of record.votes) {
    if (vote.round !== round || vote.targetId === null || vote.targetId === undefined) continue;
    counts.set(vote.targetId, (counts.get(vote.targetId) || 0) + 1);
  }
  if (counts.size === 0) return null;
  let maxVotes = 0;
  let winners = [];
  for (const [targetId, count] of counts) {
    if (count > maxVotes) {
      maxVotes = count;
      winners = [targetId];
    } else if (count === maxVotes) {
      winners.push(targetId);
    }
  }
  return winners.length === 1 ? winners[0] : null;
};

/**
 * Exile events derived from the recorded vote tallies. The replay schema has no
 * explicit exile event, so this mirrors the engine rules:
 * - a strict plurality target is exiled;
 * - a tie exiles nobody;
 * - the Idiot's first plurality target is revealed and spared (loses the vote),
 *   and a later plurality target exiles them;
 * - abstentions do not count.
 *
 * Returns `{ round, targetId, role }` for real exiles only.
 */
export const computeExileEvents = (record) => {
  const roleBySeat = new Map(record.players.map(player => [player.seat, player.role]));
  const revealedIdiots = new Set();
  const rounds = [...new Set(record.votes.map(vote => vote.round))].sort((a, b) => a - b);
  const events = [];
  for (const round of rounds) {
    const targetId = pluralityTargetOfRound(record, round);
    if (targetId === null) continue;
    const role = roleBySeat.get(targetId);
    if (role === undefined) continue;
    if (role === IDIOT_ROLE && !revealedIdiots.has(targetId)) {
      revealedIdiots.add(targetId);
      continue;
    }
    events.push({ round, targetId, role });
  }
  return events;
};

/** AI vote counts: every non-abstaining AI vote with a known target. */
export const computeAiVoteMetrics = (record) => {
  const playerBySeat = new Map(record.players.map(player => [player.seat, player]));
  let votes = 0;
  let votesOnWolf = 0;
  for (const vote of record.votes) {
    const voter = playerBySeat.get(vote.voterId);
    if (!voter || voter.isHuman) continue;
    if (vote.targetId === null || vote.targetId === undefined) continue;
    const target = playerBySeat.get(vote.targetId);
    if (!target) continue;
    votes += 1;
    if (target.role === WEREWOLF_ROLE) votesOnWolf += 1;
  }
  return { votes, votesOnWolf };
};

/**
 * Camp-separated AI vote metrics:
 * - `goodAiVoteHitWolfRate`: non-wolf AI votes hitting a Werewolf / total non-wolf AI votes
 * - `wolfTeammateProtectionRate`: wolf AI votes avoiding teammates / total wolf AI votes
 * - `wolfVoteConcentration`: mean fraction of living AI wolves voting the same target per round
 *   (computed across rounds with >= 2 AI wolf votes)
 */
export const computeCampVoteBreakdown = (record) => {
  const playerBySeat = new Map(record.players.map(player => [player.seat, player]));
  let goodAiVotes = 0;
  let goodAiVotesOnWolf = 0;
  let wolfAiVotes = 0;
  let wolfAiVotesOnNonWolf = 0;
  const wolfTargetsByRound = new Map();

  for (const vote of record.votes) {
    const voter = playerBySeat.get(vote.voterId);
    if (!voter || voter.isHuman) continue;
    if (vote.targetId === null || vote.targetId === undefined) continue;
    const target = playerBySeat.get(vote.targetId);
    if (!target) continue;

    if (voter.role === WEREWOLF_ROLE) {
      wolfAiVotes += 1;
      if (target.role !== WEREWOLF_ROLE) wolfAiVotesOnNonWolf += 1;
      const list = wolfTargetsByRound.get(vote.round) || [];
      list.push(vote.targetId);
      wolfTargetsByRound.set(vote.round, list);
    } else {
      goodAiVotes += 1;
      if (target.role === WEREWOLF_ROLE) goodAiVotesOnWolf += 1;
    }
  }

  let wolfConcentrationSum = 0;
  let wolfConcentrationRounds = 0;
  for (const targets of wolfTargetsByRound.values()) {
    if (targets.length < 2) continue;
    const counts = new Map();
    let maxSame = 0;
    for (const targetId of targets) {
      const next = (counts.get(targetId) || 0) + 1;
      counts.set(targetId, next);
      if (next > maxSame) maxSame = next;
    }
    wolfConcentrationSum += maxSame / targets.length;
    wolfConcentrationRounds += 1;
  }

  return {
    goodAiVotes,
    goodAiVotesOnWolf,
    goodAiVoteHitWolfRate: rateOf(goodAiVotesOnWolf, goodAiVotes),
    wolfAiVotes,
    wolfAiVotesOnNonWolf,
    wolfTeammateProtectionRate: rateOf(wolfAiVotesOnNonWolf, wolfAiVotes),
    wolfConcentrationSum,
    wolfConcentrationRounds,
    wolfVoteConcentration: rateOf(wolfConcentrationSum, wolfConcentrationRounds),
  };
};

/**
 * Belief volatility: for every AI actor, compare each pair of adjacent recorded
 * snapshots and sum |score_now - score_before| for targets present in both.
 * The denominator is the number of such comparable (actor, target, pair)
 * observations, so the value is the mean absolute change of a suspicion score.
 */
export const computeBeliefVolatility = (record) => {
  const snapshotsByActor = new Map();
  for (const snapshot of record.beliefSnapshots) {
    const list = snapshotsByActor.get(snapshot.actorId);
    if (list) list.push(snapshot);
    else snapshotsByActor.set(snapshot.actorId, [snapshot]);
  }

  let totalChange = 0;
  let observations = 0;
  for (const snapshots of snapshotsByActor.values()) {
    const ordered = [...snapshots].sort((a, b) => a.round - b.round);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = new Map(ordered[index - 1].scores.map(entry => [entry.targetId, entry.score]));
      for (const entry of ordered[index].scores) {
        if (!previous.has(entry.targetId)) continue;
        totalChange += Math.abs(entry.score - previous.get(entry.targetId));
        observations += 1;
      }
    }
  }
  return { totalChange, observations };
};

/**
 * Per-game metric payload. `repetition` is injected by the CLI (and by tests)
 * so that this module stays free of the TypeScript evaluation runner:
 * `{ numerator, denominator }` follows `evaluation.ts`'s repetition口径.
 */
export const computeGameMetrics = ({ id, replay, repetition }) => {
  const exiles = computeExileEvents(replay);
  const wolvesExiled = exiles.filter(event => event.role === WEREWOLF_ROLE).length;
  const aiVote = computeAiVoteMetrics(replay);
  const volatility = computeBeliefVolatility(replay);
  return {
    id,
    difficulty: replay.difficulty,
    boardId: replay.boardId,
    language: replay.language,
    winner: replay.outcome.winner,
    rounds: replay.outcome.rounds,
    aiSpeeches: toSafeNumber(repetition?.denominator),
    repeatedSpeeches: toSafeNumber(repetition?.numerator),
    aiVotes: aiVote.votes,
    aiVotesOnWolf: aiVote.votesOnWolf,
    exiles: exiles.length,
    wolvesExiled,
    beliefChange: volatility.totalChange,
    beliefObservations: volatility.observations,
  };
};

const summarizeLanguages = games => {
  const counts = new Map();
  for (const game of games) counts.set(game.language, (counts.get(game.language) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([language, count]) => `${language} ×${count}`)
    .join(', ');
};

const summarizeWinners = games => {
  const counts = new Map();
  for (const game of games) counts.set(game.winner, (counts.get(game.winner) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([winner, count]) => `${winner} ×${count}`)
    .join(', ');
};

const summarizeBoards = games => {
  const counts = new Map();
  for (const game of games) counts.set(game.boardId, (counts.get(game.boardId) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([boardId, count]) => `${boardId} ×${count}`)
    .join(', ');
};

/** Pool the per-game metrics of one difficulty into numerator/denominator pairs. */
export const summarizeDifficulty = (difficulty, games) => {
  const sum = field => games.reduce((total, game) => total + game[field], 0);
  const wolvesExiled = sum('wolvesExiled');
  const exiles = sum('exiles');
  const aiVotes = sum('aiVotes');
  const aiVotesOnWolf = sum('aiVotesOnWolf');
  const beliefChange = sum('beliefChange');
  const beliefObservations = sum('beliefObservations');
  const repeatedSpeeches = sum('repeatedSpeeches');
  const aiSpeeches = sum('aiSpeeches');

  return {
    difficulty,
    label: DIFFICULTY_LABELS[difficulty],
    n: games.length,
    boards: summarizeBoards(games),
    languages: summarizeLanguages(games),
    winners: summarizeWinners(games),
    rounds: sum('rounds'),
    aiSpeeches,
    aiVotes,
    exiles,
    wolvesExiled,
    wolfExileRate: rateOf(wolvesExiled, exiles),
    aiVoteHitWolfRate: rateOf(aiVotesOnWolf, aiVotes),
    beliefVolatility: rateOf(beliefChange, beliefObservations),
    speechRepetitionRate: rateOf(repeatedSpeeches, aiSpeeches),
    numerator: {
      wolfExileRate: wolvesExiled,
      aiVoteHitWolfRate: aiVotesOnWolf,
      beliefVolatility: beliefChange,
      speechRepetitionRate: repeatedSpeeches,
    },
    denominator: {
      wolfExileRate: exiles,
      aiVoteHitWolfRate: aiVotes,
      beliefVolatility: beliefObservations,
      speechRepetitionRate: aiSpeeches,
    },
  };
};

const DELTA_PAIRS = [
  { key: 'easyVsNormal', label: 'easy vs normal', first: 'easy', second: 'normal' },
  { key: 'normalVsHard', label: 'normal vs hard', first: 'normal', second: 'hard' },
];

/** Signed pooled-rate deltas (`first - second`) for both adjacent tier pairs. */
export const computeDeltas = summaries => DELTA_PAIRS.map(pair => ({
  key: pair.key,
  label: pair.label,
  first: pair.first,
  second: pair.second,
  metrics: Object.fromEntries(CALIBRATION_METRICS.map(metric => {
    const a = summaries[pair.first]?.rate?.[metric] ?? summaries[pair.first]?.[metric];
    const b = summaries[pair.second]?.rate?.[metric] ?? summaries[pair.second]?.[metric];
    return [metric, a === null || b === null || a === undefined || b === undefined ? null : a - b];
  })),
}));

/**
 * Analyze one fixture set. `inputs` is `{ easy: [...], normal: [...], hard: [...] }`
 * where each entry is `{ id, replay, repetition: { numerator, denominator } }`.
 */
export const analyzeCalibration = (inputs) => {
  const games = {};
  const summaries = {};
  const problems = [];

  for (const difficulty of DIFFICULTIES) {
    const entries = inputs[difficulty] || [];
    games[difficulty] = entries.map(entry => {
      if (entry.replay.difficulty !== difficulty) {
        problems.push(
          `${entry.id}: fixture difficulty "${entry.replay.difficulty}" does not match directory "${difficulty}"`,
        );
      }
      if (!DIFFICULTIES.includes(entry.replay.difficulty)) {
        problems.push(`${entry.id}: unknown difficulty "${entry.replay.difficulty}"`);
      }
      return computeGameMetrics(entry);
    });
    summaries[difficulty] = summarizeDifficulty(difficulty, games[difficulty]);
    if (games[difficulty].length === 0) {
      problems.push(`difficulty "${difficulty}" has no replay fixtures`);
    }
  }

  const seenIds = new Set();
  for (const difficulty of DIFFICULTIES) {
    for (const game of games[difficulty]) {
      if (seenIds.has(game.id)) problems.push(`duplicate fixture id "${game.id}"`);
      seenIds.add(game.id);
    }
  }

  const rates = Object.fromEntries(DIFFICULTIES.map(difficulty => [
    difficulty,
    Object.fromEntries(CALIBRATION_METRICS.map(metric => [metric, summaries[difficulty][metric]])),
  ]));
  const normalizedSummaries = Object.fromEntries(DIFFICULTIES.map(difficulty => [
    difficulty,
    { ...summaries[difficulty], rate: rates[difficulty] },
  ]));

  const deltas = computeDeltas(normalizedSummaries);
  const insufficient = DIFFICULTIES.filter(
    difficulty => summaries[difficulty].n < TARGET_GAMES_PER_DIFFICULTY,
  );
  const languagesSeen = new Set(
    DIFFICULTIES.flatMap(difficulty => games[difficulty].map(game => game.language)),
  );
  const languageWarning = languagesSeen.size > 1
    ? `样本语言不一致（${DIFFICULTIES.map(
      difficulty => `${difficulty}: ${summaries[difficulty].languages || '—'}`,
    ).join('；')}）：跨档比较混入语言变量，仅作方向性观察，不据此调参`
    : null;

  return {
    games,
    summaries, // numerator/denominator + pooled counts, used by the renderer
    rates,
    deltas,
    insufficient,
    languageWarning,
    problems,
  };
};

const formatRate = (numerator, denominator) => {
  if (!denominator) return 'n/a (0/0)';
  return `${(numerator / denominator).toFixed(6)} (${numerator}/${denominator})`;
};

const formatSumRate = (numerator, denominator) => {
  if (!denominator) return 'n/a (0/0)';
  return `${(numerator / denominator).toFixed(6)} (${numerator.toFixed(6)}/${denominator})`;
};

const formatMetricCell = (summary, metric) => {
  const numerator = summary.numerator[metric];
  const denominator = summary.denominator[metric];
  if (metric === 'beliefVolatility') return formatSumRate(numerator, denominator);
  return formatRate(numerator, denominator);
};

const formatDelta = value => {
  if (value === null || value === undefined) return 'n/a';
  const fixed = value.toFixed(6);
  return value > 0 ? `+${fixed}` : fixed;
};

/** Stable Markdown report. Pure: same analysis → same string. */
export const renderCalibrationReport = (analysis) => {
  const { summaries, deltas, insufficient, games } = analysis;
  const lines = [];

  lines.push('# Difficulty calibration report');
  lines.push('');
  lines.push('由 `scripts/difficulty-calibration.mjs` 从本地匿名回放（`schemaVersion: 1`）确定性生成。');
  lines.push('不使用时间戳、绝对路径或随机数；同一批 fixture 的两次运行输出字节一致。');
  lines.push('样本是开发者本地无外部模型的对局，**不是生产用户数据**。');
  lines.push('');

  lines.push('## 样本');
  lines.push('');
  lines.push('| 难度 | n（局） | 板型 | 语言 | 终局 | 轮数合计 | AI 发言 | AI 投票 | 放逐 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const difficulty of DIFFICULTIES) {
    const summary = summaries[difficulty];
    lines.push(
      `| ${difficulty} (${summary.label}) | ${summary.n} | ${summary.boards || '—'} | `
      + `${summary.languages || '—'} | ${summary.winners || '—'} | ${summary.rounds} | `
      + `${summary.aiSpeeches} | ${summary.aiVotes} | ${summary.exiles} |`,
    );
  }
  lines.push('');

  lines.push('## 指标定义');
  lines.push('');
  lines.push('| 指标 | 方向 | 定义（分子 / 分母） |');
  lines.push('| --- | --- | --- |');
  for (const metric of CALIBRATION_METRICS) {
    const info = METRIC_DEFINITIONS[metric];
    lines.push(`| \`${METRIC_LABELS[metric]}\` | ${info.direction} | ${info.definition} |`);
  }
  lines.push('');

  lines.push('## 结果（按难度合并；每格 = 比率 (分子/分母)）');
  lines.push('');
  lines.push(`| 难度 | n | \`${METRIC_LABELS.wolfExileRate}\` | \`${METRIC_LABELS.aiVoteHitWolfRate}\` | \`${METRIC_LABELS.beliefVolatility}\` | \`${METRIC_LABELS.speechRepetitionRate}\` |`);
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const difficulty of DIFFICULTIES) {
    const summary = summaries[difficulty];
    lines.push(
      `| ${difficulty} (${summary.label}) | ${summary.n} | ${formatMetricCell(summary, 'wolfExileRate')} | `
      + `${formatMetricCell(summary, 'aiVoteHitWolfRate')} | ${formatMetricCell(summary, 'beliefVolatility')} | `
      + `${formatMetricCell(summary, 'speechRepetitionRate')} |`,
    );
  }
  lines.push('');

  lines.push('## 差值（first − second；正负只表示方向）');
  lines.push('');
  lines.push(`| 对比 | \`${METRIC_LABELS.wolfExileRate}\` | \`${METRIC_LABELS.aiVoteHitWolfRate}\` | \`${METRIC_LABELS.beliefVolatility}\` | \`${METRIC_LABELS.speechRepetitionRate}\` |`);
  lines.push('| --- | --- | --- | --- | --- |');
  for (const delta of deltas) {
    lines.push(
      `| ${delta.label} | ${formatDelta(delta.metrics.wolfExileRate)} | `
      + `${formatDelta(delta.metrics.aiVoteHitWolfRate)} | ${formatDelta(delta.metrics.beliefVolatility)} | `
      + `${formatDelta(delta.metrics.speechRepetitionRate)} |`,
    );
  }
  lines.push('');

  lines.push('## 逐局明细');
  lines.push('');
  lines.push('| fixture | 难度 | 板型 | 终局 | 轮数 | AI 发言 | AI 投票 | 狼被放逐/放逐 | `belief-volatility` |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const perGameRows = [];
  for (const difficulty of DIFFICULTIES) {
    for (const game of games[difficulty]) {
      perGameRows.push(
        `| \`${game.id}\` | ${game.difficulty} | ${game.boardId} | ${game.winner} | ${game.rounds} | `
        + `${game.aiSpeeches} | ${game.aiVotes} | ${game.wolvesExiled}/${game.exiles} | `
        + `${formatSumRate(game.beliefChange, game.beliefObservations)} |`,
      );
    }
  }
  lines.push(...perGameRows);
  lines.push('');

  lines.push('## 样本量');
  lines.push('');
  if (insufficient.length > 0) {
    lines.push(`- ${SAMPLE_INSUFFICIENT_WARNING}`);
    lines.push(`- 未达每档 ${TARGET_GAMES_PER_DIFFICULTY} 局的难度：${
      insufficient.map(difficulty => `${difficulty} (n=${summaries[difficulty].n})`).join('、')
    }。`);
  } else {
    lines.push(`- 每档 n=${DIFFICULTIES.map(difficulty => summaries[difficulty].n).join('/')}，达到本卡目标下限（每档 ≥${TARGET_GAMES_PER_DIFFICULTY} 局）。`);
    lines.push('- 每档 3 局仍是小样本；放逐分母由局内实际放逐次数决定，可能远小于局数，差异只能作方向性观察。');
  }
  if (analysis.languageWarning) lines.push(`- ${analysis.languageWarning}`);
  lines.push('');

  lines.push('## 结论');
  lines.push('');
  lines.push('- 调参结论：**不调参**。本卡只读回放数据，未修改 `DIFFICULTY_CONFIGS` 或任何规则参数。');
  if (insufficient.length > 0) {
    lines.push(`- ${SAMPLE_INSUFFICIENT_WARNING}`);
    lines.push('- 样本不足，结论段不给出任何参数修改建议。');
  } else {
    const differing = DELTA_PAIRS.map(pair => {
      const metrics = CALIBRATION_METRICS.filter(metric => {
        const delta = deltas.find(entry => entry.key === pair.key)?.metrics[metric];
        return typeof delta === 'number' && Math.abs(delta) >= 1e-9;
      });
      return metrics.length === 0
        ? null
        : `${pair.label} 的 ${metrics.map(metric => `\`${METRIC_LABELS[metric]}\``).join('、')}`;
    }).filter(Boolean);
    if (differing.length === 0) {
      lines.push('- 在四个指标上未观察到三档之间的差异；结合下面的已知边界，这更像“样本/指标不足”，而不是“难度已足够区分”。');
    } else {
      lines.push(`- 观察到方向性差异（${differing.join('；')}），但样本量不足以下统计结论，因此不据此调参。`);
    }
    if (analysis.languageWarning) {
      lines.push(`- ${analysis.languageWarning}`);
    }
    lines.push('- 已知边界（只读核对）：`DIFFICULTY_CONFIGS` 中只有 `actionAccuracy` 进入 AI 行为路径（`useGameState` → `setAIDifficulty` → `actionSelector.selectAction` 的随机化门）；`speechQuality`、`wolfCoordination`、`mistakeRate` 只在 `src/types.ts` 定义/配置，除定义外没有消费引用。');
    lines.push('- 因果边界：难度参数中只有 `actionAccuracy` 进入 AI 行为路径；观察到的跨档差异还混杂捕获批次与样本量，不能只归因于难度。');
    lines.push('- 下一步（均不涉及参数修改）：① 把每档样本提高到 ≥30 局（同语言、同一捕获批次）并覆盖 9/12 人两种板型；② 增加表达层指标（发言长度、角色一致性、重复发言的语义距离），用于观察 `speechQuality` 类参数（如果它们将来被接线）；③ 若仍无差异，另开卡评估“难度参数是否需要被真正消费”，并重新走验收。');
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
};

/** Load `benchmarkFixtures.ts` through Vite SSR (middleware-only, no port). */
export const loadCalibrationModules = async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: REPO_ROOT,
    appType: 'custom',
    logLevel: 'error',
    cacheDir: path.join(os.tmpdir(), 'dsh-h2d-vite-cache'),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const fixtures = await server.ssrLoadModule('/src/ai/benchmarkFixtures.ts');
    return { fixtures, close: () => server.close() };
  } catch (error) {
    await server.close();
    throw error;
  }
};

const listFixtureFiles = dir => {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter(name => name.endsWith(FIXTURE_FILE_SUFFIX) && !name.startsWith('.'))
    .sort();
};

const fixtureIdFromFileName = fileName => fileName.slice(0, -FIXTURE_FILE_SUFFIX.length);

/** Read and validate one difficulty directory, returning `{ id, replay }` entries. */
export const readDifficultyFixtures = (dir, fixtures) => listFixtureFiles(dir).map(fileName => {
  const raw = readFileSync(path.join(dir, fileName), 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Fixture ${fileName} is not valid JSON`);
  }
  return {
    id: fixtureIdFromFileName(fileName),
    replay: fixtures.parseReplayFixture(parsed, fileName),
  };
});

/**
 * CLI pipeline: fixture dir → analysis. `computeRepetition(replay, id)` must
 * return `{ numerator, denominator }`; the CLI injects the evaluation.ts
 * runner through `benchmarkFixtures.buildBenchmarkFromReplay`.
 */
export const loadCalibrationAnalysis = (fixtureDir, fixtures) => {
  const inputs = {};
  for (const difficulty of DIFFICULTIES) {
    inputs[difficulty] = readDifficultyFixtures(path.join(fixtureDir, difficulty), fixtures)
      .map(entry => {
        const computation = fixtures.buildBenchmarkFromReplay(entry.replay, entry.id);
        return {
          ...entry,
          repetition: {
            numerator: computation.metrics.repeatedSpeechTurns,
            denominator: computation.metrics.aiSpeechTurns,
          },
        };
      });
  }
  return analyzeCalibration(inputs);
};

/** Load simulation modules through Vite SSR (middleware-only, no port). */
export const loadSimulationModules = async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: REPO_ROOT,
    appType: 'custom',
    logLevel: 'error',
    cacheDir: path.join(os.tmpdir(), 'dsh-h2d-vite-cache'),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  });
  try {
    const [beliefMod, actionMod, engineMod, typesMod, constantsMod] = await Promise.all([
      server.ssrLoadModule('/src/ai/beliefTracker.ts'),
      server.ssrLoadModule('/src/ai/actionSelector.ts'),
      server.ssrLoadModule('/src/gameEngine.ts'),
      server.ssrLoadModule('/src/types.ts'),
      server.ssrLoadModule('/src/constants.ts'),
    ]);
    return {
      modules: {
        BeliefTracker: beliefMod.BeliefTracker,
        selectAction: actionMod.selectAction,
        applyElimination: engineMod.applyElimination,
        applyNightResolution: engineMod.applyNightResolution,
        computeWinner: engineMod.computeWinner,
        resolveVoteResult: engineMod.resolveVoteResult,
        canWitchSelfSave: engineMod.canWitchSelfSave,
        DIFFICULTY_CONFIGS: typesMod.DIFFICULTY_CONFIGS,
        Role: typesMod.Role,
        GamePhase: typesMod.GamePhase,
        MODE_9_PLAYER: constantsMod.MODE_9_PLAYER,
        MODE_12_PLAYER: constantsMod.MODE_12_PLAYER,
      },
      close: () => server.close(),
    };
  } catch (error) {
    await server.close();
    throw error;
  }
};

// ─── P2B Seeded Offline Calibration Simulation ───────────────────────────────

const createMulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleWithRng = (items, rng) => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const percentile = (sortedAsc, p) => {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
};

const round6 = value => Math.round(value * 1e6) / 1e6;

const buildSimulatedPlayers = (boardConfig, rng, Role) => {
  const roles = shuffleWithRng(boardConfig.roles, rng);
  let assignedHopper = false;
  return roles.map((role, index) => {
    const isWolf = role === Role.WEREWOLF;
    const isWolfHopper = isWolf && !assignedHopper;
    if (isWolfHopper) assignedHopper = true;
    return {
      id: index + 1,
      name: `AI-${index + 1}`,
      role,
      camp: isWolf ? 'WEREWOLF' : 'VILLAGE',
      isAlive: true,
      canVote: true,
      isRevealed: false,
      avatarUrl: '',
      aiPersonality: '',
      traits: [],
      aiModelLabel: 'offline-sim',
      isHuman: false,
      isWolfHopper,
      publicClaims: [],
      privateKnowledge: [],
      suspicionMap: {},
    };
  });
};

/**
 * Audit seat-memory visibility isolation for a given actor:
 * - No non-wolf may hold 'wolf-team' events or know teammates.
 * - No seat may hold another seat's 'seat-private' event (e.g. Seer check or Witch info).
 */
const countUnauthorizedSeatReads = (tracker, players, Role) => {
  let violations = 0;
  for (const player of players) {
    const mem = tracker.getSeatMemory(player.id);
    if (!mem) continue;
    if (player.role !== Role.WEREWOLF && mem.knownTeammateIds.size > 0) {
      violations += 1;
    }
    for (const event of mem.visibleEvents) {
      if (event.visibility === 'wolf-team' && player.role !== Role.WEREWOLF) {
        violations += 1;
      } else if (
        event.visibility === 'seat-private' &&
        !event.visibleToSeatIds?.includes(player.id)
      ) {
        violations += 1;
      }
    }
  }
  return violations;
};

/**
 * Generate a strictly seat-visible deterministic daytime speech grounded ONLY
 * in the speaker's own private/public knowledge (never peeking hidden roles).
 */
const buildSeatVisibleSpeech = ({
  speaker,
  players,
  tracker,
  round,
  lastSeerCheck,
  witchSavedTargetId,
  wolfHopperClaimedTarget,
  Role,
  rng,
}) => {
  const aliveOthers = players.filter(p => p.isAlive && p.id !== speaker.id);
  if (aliveOthers.length === 0) return '';

  const mem = tracker.getSeatMemory(speaker.id);
  const pickTopSuspect = () => {
    let best = null;
    let bestSus = 0.52;
    for (const p of aliveOthers) {
      if (speaker.role !== Role.WEREWOLF && tracker.isConfirmedGood(p.id)) continue;
      if (speaker.role === Role.WEREWOLF && mem?.knownTeammateIds.has(p.id)) continue;
      const sus = tracker.getSuspicion(speaker.id, p.id);
      if (sus > bestSus + 1e-6) {
        bestSus = sus;
        best = p;
      }
    }
    return best;
  };

  const findPublicCheckWolfAccuser = (targetIds) => {
    if (!mem) return null;
    for (let i = mem.visibleEvents.length - 1; i >= 0; i -= 1) {
      const event = mem.visibleEvents[i];
      if (event.visibility !== 'public' || event.kind !== 'speech') continue;
      if (event.actorId === null || event.actorId === speaker.id) continue;
      if (!aliveOthers.some(p => p.id === event.actorId)) continue;
      for (const claim of event.payload.claims || []) {
        if (claim.polarity === 'check-wolf' && targetIds.has(claim.targetId)) {
          return event.actorId;
        }
      }
    }
    return null;
  };

  if (speaker.role === Role.SEER) {
    // Real Seer knows any living counter-claiming Seer is fake (strictly seat-visible).
    let fakeSeerId = null;
    if (mem) {
      for (const [claimerId, claim] of mem.publicRoleClaims.entries()) {
        if (
          claimerId !== speaker.id &&
          claim.claimedRole === Role.SEER &&
          aliveOthers.some(p => p.id === claimerId) &&
          mem.seerChecks.get(claimerId) !== true
        ) {
          fakeSeerId = claimerId;
          break;
        }
      }
    }
    const parts = ['我是预言家'];
    if (lastSeerCheck && players.some(p => p.id === lastSeerCheck.targetId)) {
      if (!lastSeerCheck.isGood) {
        parts.push(`昨晚验了${lastSeerCheck.targetId}号，${lastSeerCheck.targetId}号是查杀，今天全票出${lastSeerCheck.targetId}号`);
      } else {
        parts.push(`昨晚验了${lastSeerCheck.targetId}号，${lastSeerCheck.targetId}号是金水，我相信${lastSeerCheck.targetId}号是好人`);
      }
    }
    if (fakeSeerId !== null) {
      parts.push(`${fakeSeerId}号对跳假预言家是狼，今天投${fakeSeerId}号`);
    } else if (!lastSeerCheck || lastSeerCheck.isGood) {
      const suspect = pickTopSuspect();
      if (suspect) parts.push(`我怀疑${suspect.id}号有狼面，建议投${suspect.id}号`);
    }
    return `${parts.join('，')}。`;
  }

  if (speaker.role === Role.WEREWOLF) {
    const nonWolves = aliveOthers.filter(p => !mem?.knownTeammateIds.has(p.id));
    if (nonWolves.length === 0) return '目前局面胶着，先听后置位表水。';
    const rankedNonWolves = [...nonWolves].sort(
      (a, b) =>
        tracker.getPublicHeat(speaker.id, b.id, players) -
          tracker.getPublicHeat(speaker.id, a.id, players) || a.id - b.id,
    );
    const scapegoat =
      wolfHopperClaimedTarget && nonWolves.some(p => p.id === wolfHopperClaimedTarget)
        ? nonWolves.find(p => p.id === wolfHopperClaimedTarget)
        : rankedNonWolves[0];

    if (speaker.isWolfHopper && round === 1) {
      if (rng() < 0.5) {
        return `我是预言家，昨晚验了${scapegoat.id}号，${scapegoat.id}号是查杀，今天投${scapegoat.id}号。`;
      }
      return `我是预言家，昨晚验了${scapegoat.id}号，${scapegoat.id}号是金水，先听后置位发言。`;
    }
    // Non-hopper wolves stay low-profile unless a non-wolf already draws public heat.
    const topHeat = tracker.getPublicHeat(speaker.id, scapegoat.id, players);
    if (topHeat >= 0.35 && rng() < 0.5) {
      return `${scapegoat.id}号表水有漏洞，我怀疑${scapegoat.id}号是狼，倾向于投${scapegoat.id}号。`;
    }
    return '先听场上更多信息再决定票型。';
  }

  // Good player (Witch / Villager / Hunter / Idiot):
  // If someone gave a fake check-wolf on THIS good player (or Witch's silver water),
  // this seat knows from its own role/private info that the accuser is lying!
  const protectedSelfSet = new Set([speaker.id]);
  if (speaker.role === Role.WITCH && witchSavedTargetId !== null) {
    protectedSelfSet.add(witchSavedTargetId);
  }
  const fakeCheckerId = findPublicCheckWolfAccuser(protectedSelfSet);

  if (speaker.role === Role.WITCH) {
    const parts = [];
    if (witchSavedTargetId && witchSavedTargetId !== speaker.id && aliveOthers.some(p => p.id === witchSavedTargetId)) {
      parts.push(`${witchSavedTargetId}号是银水，我相信${witchSavedTargetId}号是好人`);
    }
    if (fakeCheckerId !== null) {
      parts.push(`${fakeCheckerId}号胡乱发假查杀，${fakeCheckerId}号是铁狼，今天全票出${fakeCheckerId}号`);
    } else {
      const suspect = pickTopSuspect();
      if (suspect) {
        parts.push(`${suspect.id}号可疑，今天建议投${suspect.id}号`);
      }
    }
    return parts.length > 0 ? `${parts.join('，')}。` : '先听大家盘逻辑再投票。';
  }

  // Villager / Hunter / Idiot: express seat-visible suspicion, rebuttal & trust
  const clauses = [];
  if (fakeCheckerId !== null) {
    clauses.push(`我是好人，${fakeCheckerId}号给我发假查杀，${fakeCheckerId}号是悍跳狼，今天投${fakeCheckerId}号`);
  }
  const suspect = pickTopSuspect();
  let trusted = null;
  let minSus = 0.44;
  for (const p of aliveOthers) {
    const sus = tracker.getSuspicion(speaker.id, p.id);
    if (sus < minSus - 1e-6) {
      minSus = sus;
      trusted = p;
    }
  }
  if (trusted) clauses.push(`我信${trusted.id}号像好人`);
  if (suspect && suspect.id !== fakeCheckerId) {
    clauses.push(`${suspect.id}号逻辑可疑，建议投${suspect.id}号`);
  }
  return clauses.length > 0 ? `${clauses.join('，')}。` : '场上信息还不够，先观望听后置位。';
};

const simulateSingleGame = ({
  modules,
  difficulty,
  boardConfig,
  seed,
  wireNewDifficultyParams,
  captureTrace = false,
}) => {
  const {
    BeliefTracker,
    selectAction,
    applyElimination,
    applyNightResolution,
    computeWinner,
    resolveVoteResult,
    canWitchSelfSave,
    DIFFICULTY_CONFIGS,
    Role,
    GamePhase,
  } = modules;

  const rng = createMulberry32(seed);
  const cfg = DIFFICULTY_CONFIGS[difficulty];
  const difficultyOpts = wireNewDifficultyParams
    ? { wolfCoordination: cfg.wolfCoordination, mistakeRate: cfg.mistakeRate }
    : {};

  let players = buildSimulatedPlayers(boardConfig, rng, Role);
  const tracker = new BeliefTracker();
  tracker.init(players);

  let witchHasSave = true;
  let witchHasPoison = true;
  let witchSavedTargetId = null;
  let lastSeerCheck = null;
  const voteRecords = [];
  const allVotes = [];
  const latenciesMs = [];
  const roleActions = {
    KILL: 0,
    CHECK: 0,
    SAVE_ACT: 0,
    SAVE_HOLD: 0,
    POISON_ACT: 0,
    POISON_HOLD: 0,
    SHOOT: 0,
    VOTE: 0,
  };
  let totalDecisions = 0;
  let illegalActions = 0;
  let fallbackDecisions = 0;
  let unauthorizedReads = 0;
  const traceEvents = [];

  const checkDecisionLegality = (actor, type, decision, currentPlayers, extra = {}) => {
    totalDecisions += 1;
    if (decision.trace) {
      latenciesMs.push(decision.trace.latencyMs);
      if (decision.trace.fallback) fallbackDecisions += 1;
    }
    if (decision.outcome !== 'ACT') return;
    const target = currentPlayers.find(p => p.id === decision.targetId);
    if (!target || !target.isAlive) {
      illegalActions += 1;
      return;
    }
    if (type !== 'SAVE' && target.id === actor.id) {
      illegalActions += 1;
      return;
    }
    if (type === 'KILL' && target.role === Role.WEREWOLF) {
      illegalActions += 1;
      return;
    }
    if (type === 'CHECK' && (target.isRevealed || extra.alreadyChecked?.has(target.id))) {
      illegalActions += 1;
      return;
    }
    if (type === 'POISON' && (target.isRevealed || extra.excludedIds?.has(target.id))) {
      illegalActions += 1;
      return;
    }
    if (type === 'SAVE' && !canWitchSelfSave(extra.round || 1, actor.id, target.id)) {
      illegalActions += 1;
    }
  };

  let winner = null;
  let finalRound = 0;
  const MAX_ROUNDS = 8;

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    finalRound = round;
    tracker.setRound(round);

    // ─── Night Phase ────────────────────────────────────────────────────────
    let wolfKillId = null;
    const livingWolves = players.filter(p => p.isAlive && p.role === Role.WEREWOLF);
    if (livingWolves.length > 0) {
      const wolfLeader = livingWolves[0];
      const killDecision = selectAction(
        wolfLeader,
        players,
        tracker,
        'KILL',
        round,
        voteRecords,
        cfg.actionAccuracy,
        { rng, phase: GamePhase.NIGHT_WEREWOLVES, ...difficultyOpts },
      );
      checkDecisionLegality(wolfLeader, 'KILL', killDecision, players, { round });
      if (killDecision.outcome === 'ACT' && killDecision.targetId !== null) {
        wolfKillId = killDecision.targetId;
        roleActions.KILL += 1;
      }
    }

    const livingSeer = players.find(p => p.isAlive && p.role === Role.SEER);
    if (livingSeer) {
      const alreadyChecked = tracker.getCheckedTargets(livingSeer.id);
      const checkDecision = selectAction(
        livingSeer,
        players,
        tracker,
        'CHECK',
        round,
        voteRecords,
        cfg.actionAccuracy,
        { rng, phase: GamePhase.NIGHT_SEER, checkedTargetIds: alreadyChecked, ...difficultyOpts },
      );
      checkDecisionLegality(livingSeer, 'CHECK', checkDecision, players, { round, alreadyChecked });
      if (checkDecision.outcome === 'ACT' && checkDecision.targetId !== null) {
        const checkedPlayer = players.find(p => p.id === checkDecision.targetId);
        if (checkedPlayer) {
          const isGood = checkedPlayer.role !== Role.WEREWOLF;
          tracker.recordSeerCheck(livingSeer.id, checkedPlayer.id, isGood, { round });
          lastSeerCheck = { targetId: checkedPlayer.id, isGood, round };
          roleActions.CHECK += 1;
          if (captureTrace) {
            traceEvents.push({
              round,
              phase: 'NIGHT_SEER',
              detail: `预言家 ${livingSeer.id}号 验 ${checkedPlayer.id}号 (${checkedPlayer.role}) -> ${isGood ? '金水' : '查杀'}`,
            });
          }
        }
      }
    }

    let witchSaved = false;
    let witchPoisonId = null;
    const livingWitch = players.find(p => p.isAlive && p.role === Role.WITCH);
    if (livingWitch) {
      if (witchHasSave && wolfKillId !== null) {
        const saveDecision = selectAction(
          livingWitch,
          players,
          tracker,
          'SAVE',
          round,
          voteRecords,
          cfg.actionAccuracy,
          { rng, phase: GamePhase.NIGHT_WITCH, wolfKillId, hasSave: witchHasSave, ...difficultyOpts },
        );
        checkDecisionLegality(livingWitch, 'SAVE', saveDecision, players, { round });
        if (saveDecision.outcome === 'ACT' && saveDecision.targetId === wolfKillId) {
          witchSaved = true;
          witchHasSave = false;
          witchSavedTargetId = wolfKillId;
          roleActions.SAVE_ACT += 1;
          tracker.recordWitchInfo(livingWitch.id, { wolfKillId, saved: true }, { round });
          if (captureTrace) {
            traceEvents.push({
              round,
              phase: 'NIGHT_WITCH',
              detail: `女巫 ${livingWitch.id}号 解药救起 ${wolfKillId}号`,
            });
          }
        } else {
          roleActions.SAVE_HOLD += 1;
        }
      }

      if (!witchSaved && witchHasPoison) {
        const excludedIds = wolfKillId !== null ? new Set([wolfKillId]) : undefined;
        const poisonDecision = selectAction(
          livingWitch,
          players,
          tracker,
          'POISON',
          round,
          voteRecords,
          cfg.actionAccuracy,
          { rng, phase: GamePhase.NIGHT_WITCH, excludedTargetIds: excludedIds, ...difficultyOpts },
        );
        checkDecisionLegality(livingWitch, 'POISON', poisonDecision, players, { round, excludedIds });
        if (poisonDecision.outcome === 'ACT' && poisonDecision.targetId !== null) {
          witchPoisonId = poisonDecision.targetId;
          witchHasPoison = false;
          roleActions.POISON_ACT += 1;
          tracker.recordWitchInfo(livingWitch.id, { wolfKillId, saved: false, poisonTargetId: witchPoisonId }, { round });
        } else {
          roleActions.POISON_HOLD += 1;
        }
      }
    }

    const nightRes = applyNightResolution(players, { wolfKillId, witchPoisonId, witchSaved });
    players = nightRes.players;
    for (const deadId of nightRes.deadIds) {
      tracker.updateFromDeath(deadId, null, players, { round, cause: 'NIGHT' });
      const deadPlayer = players.find(p => p.id === deadId);
      if (deadPlayer && deadPlayer.role === Role.HUNTER && deadId !== witchPoisonId) {
        const shotDecision = selectAction(
          deadPlayer,
          players,
          tracker,
          'SHOOT',
          round,
          voteRecords,
          cfg.actionAccuracy,
          { rng, phase: GamePhase.DAY_HUNTER_SHOT, ...difficultyOpts },
        );
        checkDecisionLegality(deadPlayer, 'SHOOT', shotDecision, players, { round });
        if (shotDecision.outcome === 'ACT' && shotDecision.targetId !== null) {
          roleActions.SHOOT += 1;
          const shotRes = applyElimination(players, shotDecision.targetId, 'HUNTER');
          players = shotRes.players;
          tracker.updateFromDeath(shotDecision.targetId, null, players, { round, cause: 'HUNTER' });
          if (shotRes.winner) {
            winner = shotRes.winner;
            break;
          }
        }
      }
    }
    winner = winner ?? computeWinner(players);
    if (winner) break;

    // ─── Day Discussion Phase (scripted seat-visible speeches) ──────────────
    // Speak in role-informative order (Seer -> Witch -> Wolves -> others) with deterministic shuffle inside tier
    const livingSpeakers = players.filter(p => p.isAlive);
    let wolfHopperClaimedTarget = null;
    for (const speaker of livingSpeakers) {
      const text = buildSeatVisibleSpeech({
        speaker,
        players,
        tracker,
        round,
        lastSeerCheck: speaker.role === Role.SEER ? lastSeerCheck : null,
        witchSavedTargetId: speaker.role === Role.WITCH ? witchSavedTargetId : null,
        wolfHopperClaimedTarget,
        Role,
        rng,
      });
      if (!text) continue;
      if (speaker.role === Role.WEREWOLF && speaker.isWolfHopper && round === 1) {
        const m = text.match(/(\d+)号是查杀/);
        if (m) wolfHopperClaimedTarget = Number.parseInt(m[1], 10);
      }
      tracker.updateFromSpeech(speaker.id, text, players, { round });
      if (captureTrace && (speaker.role === Role.SEER || speaker.role === Role.WITCH || (speaker.role === Role.WEREWOLF && speaker.isWolfHopper))) {
        traceEvents.push({
          round,
          phase: 'DAY_DISCUSSION',
          detail: `${speaker.id}号(${speaker.role}): "${text}"`,
        });
      }
    }

    unauthorizedReads += countUnauthorizedSeatReads(tracker, players, Role);

    // ─── Day Voting Phase (simultaneous ballot settlement) ──────────────────
    const voters = players.filter(p => p.isAlive && p.canVote);
    const roundBallots = [];
    const tally = {};
    for (const voter of voters) {
      const voteDecision = selectAction(
        voter,
        players,
        tracker,
        'VOTE',
        round,
        voteRecords,
        cfg.actionAccuracy,
        {
          rng,
          phase: GamePhase.DAY_VOTING,
          deferVoteBeliefUpdate: true,
          ...difficultyOpts,
        },
      );
      checkDecisionLegality(voter, 'VOTE', voteDecision, players, { round });
      if (voteDecision.outcome === 'ACT' && voteDecision.targetId !== null) {
        roleActions.VOTE += 1;
        roundBallots.push({
          round,
          voterId: voter.id,
          voterRole: voter.role,
          targetId: voteDecision.targetId,
          reason: voteDecision.reason,
          randomized: Boolean(voteDecision.randomized),
        });
        tally[voteDecision.targetId] = (tally[voteDecision.targetId] || 0) + 1;
      }
    }

    for (const ballot of roundBallots) {
      voteRecords.push({
        round,
        voterId: ballot.voterId,
        targetId: ballot.targetId,
        phase: GamePhase.DAY_VOTING,
      });
      allVotes.push({ round, voterId: ballot.voterId, targetId: ballot.targetId });
      tracker.updateFromVote(ballot.voterId, ballot.targetId, { players, round });
    }

    const exiledId = resolveVoteResult(tally);
    if (captureTrace && roundBallots.length > 0) {
      const wolfVotesStr = roundBallots
        .filter(b => b.voterRole === Role.WEREWOLF)
        .map(b => `${b.voterId}->${b.targetId}(${b.reason})`)
        .join(', ');
      const goodVotesStr = roundBallots
        .filter(b => b.voterRole !== Role.WEREWOLF)
        .map(b => `${b.voterId}->${b.targetId}`)
        .join(', ');
      const exiledPlayer = exiledId !== null ? players.find(p => p.id === exiledId) : null;
      traceEvents.push({
        round,
        phase: 'DAY_VOTING',
        detail: `好人票:[${goodVotesStr}] | 狼队票:[${wolfVotesStr}] -> 放逐: ${
          exiledPlayer ? `${exiledPlayer.id}号(${exiledPlayer.role})` : '平票无人出局'
        }`,
      });
    }

    if (exiledId !== null) {
      const elim = applyElimination(players, exiledId, 'VOTE');
      players = elim.players;
      if (elim.sparedByIdiot) {
        tracker.updateFromIdiotFlip(exiledId, players, { round });
      } else if (elim.eliminated) {
        tracker.updateFromDeath(exiledId, null, players, { round, cause: 'VOTE' });
        const exiledPlayer = players.find(p => p.id === exiledId);
        if (exiledPlayer && exiledPlayer.role === Role.HUNTER && !elim.winner) {
          const shotDecision = selectAction(
            exiledPlayer,
            players,
            tracker,
            'SHOOT',
            round,
            voteRecords,
            cfg.actionAccuracy,
            { rng, phase: GamePhase.DAY_HUNTER_SHOT, ...difficultyOpts },
          );
          checkDecisionLegality(exiledPlayer, 'SHOOT', shotDecision, players, { round });
          if (shotDecision.outcome === 'ACT' && shotDecision.targetId !== null) {
            roleActions.SHOOT += 1;
            const shotRes = applyElimination(players, shotDecision.targetId, 'HUNTER');
            players = shotRes.players;
            tracker.updateFromDeath(shotDecision.targetId, null, players, { round, cause: 'HUNTER' });
          }
        }
      }
    }

    winner = computeWinner(players);
    if (winner) break;
  }

  const record = {
    players: players.map(p => ({ seat: p.id, role: p.role, isHuman: p.isHuman })),
    votes: allVotes,
  };
  const breakdown = computeCampVoteBreakdown(record);
  const exiles = computeExileEvents(record);
  const wolvesExiled = exiles.filter(e => e.role === WEREWOLF_ROLE).length;

  return {
    seed,
    difficulty,
    boardId: boardConfig.id,
    winner: winner ?? 'TIMEOUT',
    rounds: finalRound,
    players: record.players,
    breakdown,
    exiles: exiles.length,
    wolvesExiled,
    roleActions,
    totalDecisions,
    illegalActions,
    fallbackDecisions,
    unauthorizedReads,
    latenciesMs,
    traceEvents,
  };
};

const aggregateTierRuns = (difficulty, runs) => {
  const sum = getter => runs.reduce((acc, r) => acc + getter(r), 0);
  const goodAiVotes = sum(r => r.breakdown.goodAiVotes);
  const goodAiVotesOnWolf = sum(r => r.breakdown.goodAiVotesOnWolf);
  const wolfAiVotes = sum(r => r.breakdown.wolfAiVotes);
  const wolfAiVotesOnNonWolf = sum(r => r.breakdown.wolfAiVotesOnNonWolf);
  const wolfConcentrationSum = sum(r => r.breakdown.wolfConcentrationSum);
  const wolfConcentrationRounds = sum(r => r.breakdown.wolfConcentrationRounds);
  const exiles = sum(r => r.exiles);
  const wolvesExiled = sum(r => r.wolvesExiled);
  const totalDecisions = sum(r => r.totalDecisions);
  const illegalActions = sum(r => r.illegalActions);
  const fallbackDecisions = sum(r => r.fallbackDecisions);
  const unauthorizedReads = sum(r => r.unauthorizedReads);
  const allLatencies = runs.flatMap(r => r.latenciesMs).sort((a, b) => a - b);

  const roleActionDistribution = {
    KILL: sum(r => r.roleActions.KILL),
    CHECK: sum(r => r.roleActions.CHECK),
    SAVE_ACT: sum(r => r.roleActions.SAVE_ACT),
    SAVE_HOLD: sum(r => r.roleActions.SAVE_HOLD),
    POISON_ACT: sum(r => r.roleActions.POISON_ACT),
    POISON_HOLD: sum(r => r.roleActions.POISON_HOLD),
    SHOOT: sum(r => r.roleActions.SHOOT),
    VOTE: sum(r => r.roleActions.VOTE),
  };

  const boardCounts = { '9-standard': 0, '12-standard': 0 };
  const winnerCounts = { VILLAGERS: 0, WEREWOLVES: 0, TIMEOUT: 0 };
  for (const r of runs) {
    boardCounts[r.boardId] = (boardCounts[r.boardId] || 0) + 1;
    winnerCounts[r.winner] = (winnerCounts[r.winner] || 0) + 1;
  }

  return {
    difficulty,
    label: DIFFICULTY_LABELS[difficulty],
    games: runs.length,
    boardCounts,
    winnerCounts,
    roundsTotal: sum(r => r.rounds),
    exiles,
    wolvesExiled,
    wolfExileRate: rateOf(wolvesExiled, exiles),
    goodAiVotes,
    goodAiVotesOnWolf,
    goodAiVoteHitWolfRate: rateOf(goodAiVotesOnWolf, goodAiVotes),
    wolfAiVotes,
    wolfAiVotesOnNonWolf,
    wolfTeammateProtectionRate: rateOf(wolfAiVotesOnNonWolf, wolfAiVotes),
    wolfConcentrationRounds,
    wolfVoteConcentration: rateOf(wolfConcentrationSum, wolfConcentrationRounds),
    totalDecisions,
    illegalActions,
    illegalActionRate: rateOf(illegalActions, totalDecisions) ?? 0,
    fallbackDecisions,
    fallbackRate: rateOf(fallbackDecisions, totalDecisions) ?? 0,
    unauthorizedReads,
    unauthorizedInfoReadRate: rateOf(unauthorizedReads, totalDecisions) ?? 0,
    roleActionDistribution,
    latencyMs: {
      p50: round6(percentile(allLatencies, 0.5)),
      p95: round6(percentile(allLatencies, 0.95)),
    },
  };
};

/**
 * Run a deterministic seeded offline calibration simulation across easy/normal/hard
 * (50% 9-standard + 50% 12-standard per tier) for both baseline (unwired) and
 * optimized (P2B wired `wolfCoordination` + `mistakeRate`) modes.
 */
export const runSeededCalibrationSimulation = (
  modules,
  { gamesPerTier = 30, baseSeed = 20261124 } = {},
) => {
  const safeN = Math.max(2, Math.floor(gamesPerTier));
  const half9 = Math.floor(safeN / 2);

  const runVariant = (wireNewDifficultyParams) => {
    const tiers = {};
    const sampleRuns = {};
    for (let t = 0; t < DIFFICULTIES.length; t += 1) {
      const difficulty = DIFFICULTIES[t];
      const runs = [];
      for (let g = 0; g < safeN; g += 1) {
        const boardConfig = g < half9 ? modules.MODE_9_PLAYER : modules.MODE_12_PLAYER;
        // Identical seed per game index across tiers so all three tiers play paired board setups
        const seed = (baseSeed + g * 9973) >>> 0;
        const captureTrace =
          wireNewDifficultyParams &&
          ((difficulty === 'hard' && g === 0) ||
            (difficulty === 'hard' && g === half9) ||
            (difficulty === 'easy' && g === 0));
        const result = simulateSingleGame({
          modules,
          difficulty,
          boardConfig,
          seed,
          wireNewDifficultyParams,
          captureTrace,
        });
        runs.push(result);
        if (captureTrace) {
          sampleRuns[`${difficulty}-${boardConfig.id}-g${g}`] = result;
        }
      }
      tiers[difficulty] = aggregateTierRuns(difficulty, runs);
    }
    return { tiers, sampleRuns };
  };

  const baseline = runVariant(false);
  const optimized = runVariant(true);

  // Paired walkthrough 3: same seed (baseSeed + 1 * 9973) under easy vs hard on 9-standard
  const pairedSeed = (baseSeed + 9973) >>> 0;
  const pairedEasy = simulateSingleGame({
    modules,
    difficulty: 'easy',
    boardConfig: modules.MODE_9_PLAYER,
    seed: pairedSeed,
    wireNewDifficultyParams: true,
    captureTrace: true,
  });
  const pairedHard = simulateSingleGame({
    modules,
    difficulty: 'hard',
    boardConfig: modules.MODE_9_PLAYER,
    seed: pairedSeed,
    wireNewDifficultyParams: true,
    captureTrace: true,
  });

  const hard9 = optimized.sampleRuns[`hard-9-standard-g0`];
  const hard12 = optimized.sampleRuns[`hard-12-standard-g${half9}`];

  const walkthroughs = [
    {
      id: 'walkthrough-1-hard-9p',
      title: `9人局 Expert 档（seed=${hard9.seed}）：预言家查杀驱动好人集火与狼队协同冲票`,
      boardId: hard9.boardId,
      difficulty: 'hard',
      winner: hard9.winner,
      rounds: hard9.rounds,
      summary: `goodAiVoteHitWolfRate=${(hard9.breakdown.goodAiVoteHitWolfRate ?? 0).toFixed(3)} (${hard9.breakdown.goodAiVotesOnWolf}/${hard9.breakdown.goodAiVotes}), wolfTeammateProtectionRate=${(hard9.breakdown.wolfTeammateProtectionRate ?? 0).toFixed(3)}, wolfVoteConcentration=${(hard9.breakdown.wolfVoteConcentration ?? 0).toFixed(3)}`,
      steps: hard9.traceEvents.slice(0, 10),
    },
    {
      id: 'walkthrough-2-hard-12p',
      title: `12人局 Expert 档（seed=${hard12.seed}）：女巫银水与神职跳身份引发狼队跨轮协同切目标`,
      boardId: hard12.boardId,
      difficulty: 'hard',
      winner: hard12.winner,
      rounds: hard12.rounds,
      summary: `goodAiVoteHitWolfRate=${(hard12.breakdown.goodAiVoteHitWolfRate ?? 0).toFixed(3)} (${hard12.breakdown.goodAiVotesOnWolf}/${hard12.breakdown.goodAiVotes}), wolfTeammateProtectionRate=${(hard12.breakdown.wolfTeammateProtectionRate ?? 0).toFixed(3)}, wolfVoteConcentration=${(hard12.breakdown.wolfVoteConcentration ?? 0).toFixed(3)}`,
      steps: hard12.traceEvents.slice(0, 10),
    },
    {
      id: 'walkthrough-3-paired-easy-vs-hard',
      title: `同局配对对比（9人局 seed=${pairedSeed}）：Beginner (easy) vs Expert (hard) 投票集中度与好人命中分化`,
      boardId: '9-standard',
      difficulty: 'easy vs hard',
      winner: `easy=${pairedEasy.winner} / hard=${pairedHard.winner}`,
      rounds: `${pairedEasy.rounds} vs ${pairedHard.rounds}`,
      summary: `easy goodHit=${(pairedEasy.breakdown.goodAiVoteHitWolfRate ?? 0).toFixed(3)} / wolfConc=${(pairedEasy.breakdown.wolfVoteConcentration ?? 0).toFixed(3)} vs hard goodHit=${(pairedHard.breakdown.goodAiVoteHitWolfRate ?? 0).toFixed(3)} / wolfConc=${(pairedHard.breakdown.wolfVoteConcentration ?? 0).toFixed(3)}`,
      steps: [
        ...pairedEasy.traceEvents.slice(0, 4).map(e => ({ ...e, detail: `[easy] ${e.detail}` })),
        ...pairedHard.traceEvents.slice(0, 4).map(e => ({ ...e, detail: `[hard] ${e.detail}` })),
      ],
    },
  ];

  const optEasy = optimized.tiers.easy;
  const optNormal = optimized.tiers.normal;
  const optHard = optimized.tiers.hard;
  const monotonicity = {
    goodAiVoteHitWolfRate:
      (optHard.goodAiVoteHitWolfRate ?? 0) > (optNormal.goodAiVoteHitWolfRate ?? 0) &&
      (optNormal.goodAiVoteHitWolfRate ?? 0) > (optEasy.goodAiVoteHitWolfRate ?? 0),
    wolfTeammateProtectionRate:
      (optHard.wolfTeammateProtectionRate ?? 0) >= (optNormal.wolfTeammateProtectionRate ?? 0) &&
      (optNormal.wolfTeammateProtectionRate ?? 0) >= (optEasy.wolfTeammateProtectionRate ?? 0),
    wolfVoteConcentration:
      (optHard.wolfVoteConcentration ?? 0) > (optNormal.wolfVoteConcentration ?? 0) &&
      (optNormal.wolfVoteConcentration ?? 0) > (optEasy.wolfVoteConcentration ?? 0),
  };

  return {
    gamesPerTier: safeN,
    totalGames: safeN * DIFFICULTIES.length,
    baseSeed,
    baseline: baseline.tiers,
    optimized: optimized.tiers,
    monotonicity,
    walkthroughs,
  };
};

const fmtPct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(2)}%`);

/** Render deterministic Markdown summary for `--simulate <n>`. */
export const renderSimulationCalibrationReport = (sim) => {
  const lines = [];
  lines.push(`# P2B 确定性离线仿真校准报告（n=${sim.gamesPerTier} 局/档，总计 ${sim.totalGames} 局）`);
  lines.push('');
  lines.push(`- 种子基址：\`baseSeed=${sim.baseSeed}\`，每档覆盖 50% \`9-standard\` + 50% \`12-standard\`。`);
  lines.push('- 执行链路：真实 `BeliefTracker` + `selectAction` + `gameEngine`（零网络、零 LLM 调用）。');
  lines.push('');
  lines.push('## P2B 接线后指标（`actionAccuracy` + `wolfCoordination` + `mistakeRate`）');
  lines.push('');
  lines.push('| 难度 | n（9p/12p） | `goodAiVoteHitWolfRate` | `wolfTeammateProtectionRate` | `wolfVoteConcentration` | `illegalActionRate` | `unauthorizedReadRate` | `fallbackRate` | 决策延迟 p50/p95 (ms) |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const d of DIFFICULTIES) {
    const t = sim.optimized[d];
    lines.push(
      `| ${d} (${t.label}) | ${t.games} (${t.boardCounts['9-standard']}/${t.boardCounts['12-standard']}) | ` +
      `${fmtPct(t.goodAiVoteHitWolfRate)} (${t.goodAiVotesOnWolf}/${t.goodAiVotes}) | ` +
      `${fmtPct(t.wolfTeammateProtectionRate)} (${t.wolfAiVotesOnNonWolf}/${t.wolfAiVotes}) | ` +
      `${fmtPct(t.wolfVoteConcentration)} (${t.wolfConcentrationRounds} rounds) | ` +
      `${t.illegalActionRate.toFixed(6)} (${t.illegalActions}/${t.totalDecisions}) | ` +
      `${t.unauthorizedInfoReadRate.toFixed(6)} (${t.unauthorizedReads}/${t.totalDecisions}) | ` +
      `${t.fallbackRate.toFixed(6)} (${t.fallbackDecisions}/${t.totalDecisions}) | ` +
      `${t.latencyMs.p50.toFixed(3)} / ${t.latencyMs.p95.toFixed(3)} |`,
    );
  }
  lines.push('');
  lines.push('## 基线（仅 `actionAccuracy`）vs P2B 接线后（同种子配对）');
  lines.push('');
  lines.push('| 难度 | 基线 `goodHit` | P2B `goodHit` | 基线 `wolfProtect` | P2B `wolfProtect` | 基线 `wolfConc` | P2B `wolfConc` |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const d of DIFFICULTIES) {
    const b = sim.baseline[d];
    const o = sim.optimized[d];
    lines.push(
      `| ${d} | ${fmtPct(b.goodAiVoteHitWolfRate)} | ${fmtPct(o.goodAiVoteHitWolfRate)} | ` +
      `${fmtPct(b.wolfTeammateProtectionRate)} | ${fmtPct(o.wolfTeammateProtectionRate)} | ` +
      `${fmtPct(b.wolfVoteConcentration)} | ${fmtPct(o.wolfVoteConcentration)} |`,
    );
  }
  lines.push('');
  lines.push('## 角色动作分布（P2B 接线后，合计）');
  lines.push('');
  lines.push('| 难度 | KILL | CHECK | SAVE(ACT/HOLD) | POISON(ACT/HOLD) | SHOOT | VOTE |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const d of DIFFICULTIES) {
    const dist = sim.optimized[d].roleActionDistribution;
    lines.push(
      `| ${d} | ${dist.KILL} | ${dist.CHECK} | ${dist.SAVE_ACT}/${dist.SAVE_HOLD} | ${dist.POISON_ACT}/${dist.POISON_HOLD} | ${dist.SHOOT} | ${dist.VOTE} |`,
    );
  }
  lines.push('');
  lines.push('## 单调性检查');
  lines.push('');
  lines.push(`- \`goodAiVoteHitWolfRate\` (\`hard > normal > easy\`): ${sim.monotonicity.goodAiVoteHitWolfRate ? 'PASS' : 'FAIL'}`);
  lines.push(`- \`wolfTeammateProtectionRate\` (\`hard >= normal >= easy\`): ${sim.monotonicity.wolfTeammateProtectionRate ? 'PASS' : 'FAIL'}`);
  lines.push(`- \`wolfVoteConcentration\` (\`hard > normal > easy\`): ${sim.monotonicity.wolfVoteConcentration ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('## 典型回放走查（3 例）');
  lines.push('');
  for (const w of sim.walkthroughs) {
    lines.push(`### ${w.title}`);
    lines.push(`- 板型：\`${w.boardId}\`；胜方：\`${w.winner}\`；轮数：${w.rounds}；摘要：${w.summary}`);
    for (const step of w.steps) {
      lines.push(`  - R${step.round} [${step.phase}] ${step.detail}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
};

const isCliEntry = () => {
  const entry = process.argv[1];
  return entry ? import.meta.url === pathToFileURL(path.resolve(entry)).href : false;
};

const main = async () => {
  const args = process.argv.slice(2);
  const optionValue = name => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const fixtureDirArg = optionValue('fixtures');
  const simulateArg = optionValue('simulate');
  const seedArg = optionValue('seed');
  const outFile = optionValue('out');
  const fixtureDir = fixtureDirArg
    ? path.resolve(REPO_ROOT, fixtureDirArg)
    : path.join(REPO_ROOT, DEFAULT_FIXTURES_DIR);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(
      'Usage: node scripts/difficulty-calibration.mjs [--fixtures <dir>] [--simulate <n> [--seed <int>]] [--out <file>]',
    );
    return;
  }

  if (simulateArg !== undefined) {
    const gamesPerTier = Number.parseInt(simulateArg, 10);
    if (!Number.isInteger(gamesPerTier) || gamesPerTier < 2) {
      throw new Error(`--simulate expects an integer >= 2, got "${simulateArg}"`);
    }
    const baseSeed = seedArg !== undefined ? Number.parseInt(seedArg, 10) : 20261124;
    const { modules, close } = await loadSimulationModules();
    try {
      const sim = runSeededCalibrationSimulation(modules, { gamesPerTier, baseSeed });
      const report = renderSimulationCalibrationReport(sim);
      if (outFile) writeFileSync(outFile, report, 'utf8');
      process.stdout.write(report);
      const anyIllegal = DIFFICULTIES.some(d => sim.optimized[d].illegalActions > 0 || sim.optimized[d].unauthorizedReads > 0);
      if (
        anyIllegal ||
        !sim.monotonicity.goodAiVoteHitWolfRate ||
        !sim.monotonicity.wolfTeammateProtectionRate ||
        !sim.monotonicity.wolfVoteConcentration
      ) {
        console.error('seeded calibration monotonicity/safety check: FAIL');
        process.exitCode = 1;
      }
    } finally {
      await close();
    }
    return;
  }

  const { fixtures, close } = await loadCalibrationModules();
  try {
    const analysis = loadCalibrationAnalysis(fixtureDir, fixtures);
    const report = renderCalibrationReport(analysis);
    if (outFile) writeFileSync(outFile, report, 'utf8');
    process.stdout.write(report);
    if (analysis.problems.length > 0) {
      for (const problem of analysis.problems) console.error(`- ${problem}`);
      console.error('difficulty calibration: FAIL');
      process.exitCode = 1;
    }
  } finally {
    await close();
  }
};

if (isCliEntry()) {
  main().catch(error => {
    console.error(`difficulty calibration failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}

// --- END OF FILE scripts/difficulty-calibration.mjs ---
