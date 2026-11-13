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
  const outFile = optionValue('out');
  const fixtureDir = fixtureDirArg
    ? path.resolve(REPO_ROOT, fixtureDirArg)
    : path.join(REPO_ROOT, DEFAULT_FIXTURES_DIR);

  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/difficulty-calibration.mjs [--fixtures <dir>] [--out <file>]');
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
