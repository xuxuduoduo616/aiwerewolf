import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  analyzeCalibration,
  computeAiVoteMetrics,
  computeBeliefVolatility,
  computeExileEvents,
  pluralityTargetOfRound,
  renderCalibrationReport,
  SAMPLE_INSUFFICIENT_WARNING,
  summarizeDifficulty,
  TARGET_GAMES_PER_DIFFICULTY,
} from './difficulty-calibration.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./difficulty-calibration.mjs', import.meta.url));
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

const PLAYERS = [
  { seat: 1, role: 'Villager', isHuman: true },
  { seat: 2, role: 'Werewolf', isHuman: false },
  { seat: 3, role: 'Seer', isHuman: false },
  { seat: 4, role: 'Idiot', isHuman: false },
  { seat: 5, role: 'Villager', isHuman: false },
];

const makeReplay = ({
  difficulty = 'normal',
  language = 'zh',
  votes = [],
  beliefSnapshots = [],
  speeches = [],
  players = PLAYERS,
  boardId = '9-standard',
  winner = 'VILLAGERS',
  rounds = 2,
} = {}) => ({
  schemaVersion: 1,
  gameId: `test-${difficulty}`,
  createdAt: '2026-01-01T00:00:00.000Z',
  boardId,
  difficulty,
  language,
  isGuest: true,
  players,
  phases: [
    { phase: 'NIGHT_START', round: 0 },
    { phase: 'GAME_OVER', round: rounds },
  ],
  speeches,
  votes,
  beliefSnapshots,
  wolfChat: [],
  checks: [],
  outcome: { winner, rounds },
});

const entry = (id, replay, repetition = { numerator: 0, denominator: 0 }) => ({ id, replay, repetition });

describe('exile derivation', () => {
  it('mirrors plurality, tie and idiot-reveal rules', () => {
    const replay = makeReplay({
      votes: [
        // Round 1: seat 2 (Werewolf) has 3 votes -> exiled.
        { round: 1, voterId: 1, targetId: 2 },
        { round: 1, voterId: 2, targetId: 1 },
        { round: 1, voterId: 3, targetId: 2 },
        { round: 1, voterId: 4, targetId: 2 },
        { round: 1, voterId: 5, targetId: 1 },
        // Round 2: 3 vs 5 tie -> nobody is exiled.
        { round: 2, voterId: 1, targetId: 3 },
        { round: 2, voterId: 3, targetId: 5 },
        // Round 3: the Idiot (4) is the plurality target, revealed and spared.
        { round: 3, voterId: 1, targetId: 4 },
        { round: 3, voterId: 2, targetId: 4 },
        // Round 4: the already-revealed Idiot is exiled on a second plurality.
        { round: 4, voterId: 1, targetId: 4 },
        { round: 4, voterId: 3, targetId: 4 },
        // Abstentions never enter the tally.
        { round: 4, voterId: 5, targetId: null },
      ],
    });

    expect(pluralityTargetOfRound(replay, 1)).toBe(2);
    expect(pluralityTargetOfRound(replay, 2)).toBeNull();
    expect(pluralityTargetOfRound(replay, 4)).toBe(4);
    expect(computeExileEvents(replay)).toEqual([
      { round: 1, targetId: 2, role: 'Werewolf' },
      { round: 4, targetId: 4, role: 'Idiot' },
    ]);
  });

  it('ignores missing targets and empty rounds', () => {
    const replay = makeReplay({
      votes: [
        { round: 1, voterId: 1, targetId: 99 },
        { round: 2, voterId: 1, targetId: null },
      ],
    });
    expect(computeExileEvents(replay)).toEqual([]);
  });
});

describe('AI vote metrics', () => {
  it('counts only AI votes with a known target and counts teammate votes as wolf hits', () => {
    const replay = makeReplay({
      votes: [
        { round: 1, voterId: 1, targetId: 2 }, // human vote: excluded
        { round: 1, voterId: 2, targetId: 3 }, // AI werewolf -> villager: miss
        { round: 1, voterId: 3, targetId: 2 }, // AI seer -> werewolf: hit
        { round: 1, voterId: 4, targetId: null }, // abstention: excluded
        { round: 1, voterId: 5, targetId: 2 }, // AI villager -> werewolf: hit
      ],
    });
    expect(computeAiVoteMetrics(replay)).toEqual({ votes: 3, votesOnWolf: 2 });
  });
});

describe('belief volatility', () => {
  it('averages absolute score changes over comparable adjacent snapshots', () => {
    const replay = makeReplay({
      beliefSnapshots: [
        { round: 1, actorId: 2, scores: [{ targetId: 1, score: 0.2 }, { targetId: 3, score: 0.5 }] },
        { round: 2, actorId: 2, scores: [{ targetId: 1, score: 0.5 }, { targetId: 3, score: 0.1 }] },
        { round: 1, actorId: 3, scores: [{ targetId: 1, score: 0.1 }] },
        { round: 2, actorId: 3, scores: [{ targetId: 1, score: 0.4 }, { targetId: 2, score: 0.9 }] },
      ],
    });
    const volatility = computeBeliefVolatility(replay);
    // actor 2: |0.5-0.2| + |0.1-0.5| = 0.7 over 2 observations;
    // actor 3: |0.4-0.1| = 0.3 over 1 observation (seat 2 is new in round 2).
    expect(volatility.observations).toBe(3);
    expect(volatility.totalChange).toBeCloseTo(1, 10);
    expect(volatility.totalChange / volatility.observations).toBeCloseTo(1 / 3, 10);
  });

  it('returns an empty numerator/denominator without snapshots', () => {
    expect(computeBeliefVolatility(makeReplay())).toEqual({ totalChange: 0, observations: 0 });
  });
});

describe('difficulty summaries', () => {
  it('pools numerators and denominators across games', () => {
    const games = [
      {
        exiles: 2, wolvesExiled: 1, aiVotes: 3, aiVotesOnWolf: 2,
        beliefChange: 0.6, beliefObservations: 2, repeatedSpeeches: 1, aiSpeeches: 4,
        rounds: 2, boardId: '9-standard',
      },
      {
        exiles: 2, wolvesExiled: 1, aiVotes: 5, aiVotesOnWolf: 3,
        beliefChange: 0.4, beliefObservations: 3, repeatedSpeeches: 0, aiSpeeches: 6,
        rounds: 3, boardId: '12-standard',
      },
    ];
    const summary = summarizeDifficulty('easy', games);
    expect(summary.n).toBe(2);
    expect(summary.boards).toBe('12-standard ×1, 9-standard ×1');
    expect(summary.numerator.wolfExileRate).toBe(2);
    expect(summary.denominator.wolfExileRate).toBe(4);
    expect(summary.wolfExileRate).toBeCloseTo(0.5);
    expect(summary.aiVoteHitWolfRate).toBeCloseTo(5 / 8);
    expect(summary.beliefVolatility).toBeCloseTo(0.2);
    expect(summary.speechRepetitionRate).toBeCloseTo(0.1);
  });
});

describe('calibration report', () => {
  const onePerTier = difficulty => entry(
    `${difficulty}-only`,
    makeReplay({ difficulty }),
    { numerator: 1, denominator: 4 },
  );

  it('prints the exact n<3 warning and never suggests a parameter change', () => {
    const analysis = analyzeCalibration({
      easy: [onePerTier('easy')],
      normal: [onePerTier('normal')],
      hard: [onePerTier('hard')],
    });
    const report = renderCalibrationReport(analysis);

    expect(report).toContain(SAMPLE_INSUFFICIENT_WARNING);
    expect(report).toContain('样本不足（n<3）：仅方向性观察，不据此调参');
    expect(report).toContain('| easy (Beginner) | 1 |');
    expect(report).toContain('不调参');
    expect(report).not.toContain('调大');
    expect(report).toContain('0.250000 (1/4)');
    expect(report).not.toContain('undefined');
    expect(report).not.toContain('NaN');
  });

  it('omits the warning once every tier reaches the target sample size', () => {
    const tier = difficulty => Array.from({ length: TARGET_GAMES_PER_DIFFICULTY }, (_, index) => entry(
      `${difficulty}-${index + 1}`,
      makeReplay({ difficulty }),
      { numerator: index, denominator: 4 },
    ));
    const analysis = analyzeCalibration({
      easy: tier('easy'),
      normal: tier('normal'),
      hard: tier('hard'),
    });
    const report = renderCalibrationReport(analysis);

    expect(report).not.toContain('样本不足（n<3）');
    expect(report).toContain('| easy (Beginner) | 3 |');
    expect(report).toContain('| hard (Expert) | 3 |');
    expect(report).toContain('调参结论：**不调参**');
    expect(analysis.languageWarning).toBeNull();
    expect(report).toContain('zh ×3');
    expect(report).not.toContain('样本语言不一致');
  });

  it('flags mixed sample languages instead of comparing them silently', () => {
    const analysis = analyzeCalibration({
      easy: [entry('easy-zh', makeReplay({ difficulty: 'easy', language: 'zh' }))],
      normal: [entry('normal-en', makeReplay({ difficulty: 'normal', language: 'en' }))],
      hard: [entry('hard-zh', makeReplay({ difficulty: 'hard', language: 'zh' }))],
    });
    expect(analysis.languageWarning).toContain('样本语言不一致');
    const report = renderCalibrationReport(analysis);
    expect(report).toContain('样本语言不一致');
    expect(report).toContain('easy: zh ×1');
    expect(report).toContain('normal: en ×1');
    expect(report).toContain('跨档比较混入语言变量');
    expect(report).toContain('不据此调参');
  });

  it('renders deterministically without timestamps or absolute paths', () => {
    const analysis = analyzeCalibration({
      easy: [onePerTier('easy')],
      normal: [onePerTier('normal')],
      hard: [onePerTier('hard')],
    });
    const first = renderCalibrationReport(analysis);
    const second = renderCalibrationReport(analysis);
    expect(second).toBe(first);
    expect(first).not.toContain(REPO_ROOT);
    expect(first).not.toContain(os.tmpdir());
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  it('reports empty tiers as a problem instead of inventing a rate', () => {
    const analysis = analyzeCalibration({
      easy: [onePerTier('easy')],
      normal: [onePerTier('normal')],
      hard: [],
    });
    expect(analysis.problems).toContain('difficulty "hard" has no replay fixtures');
    const report = renderCalibrationReport(analysis);
    expect(report).toContain('| hard (Expert) | 0 | — | — | — | 0 | 0 | 0 | 0 |');
    expect(report).toContain('n/a (0/0)');
  });
});

describe('difficulty-calibration CLI', () => {
  const writeFixtureSet = root => {
    for (const difficulty of ['easy', 'normal', 'hard']) {
      const dir = path.join(root, difficulty);
      mkdirSync(dir, { recursive: true });
      const replay = makeReplay({
        difficulty,
        boardId: difficulty === 'normal' ? '12-standard' : '9-standard',
        rounds: 2,
        speeches: [
          { round: 1, phase: 'DAY_DISCUSSION', speakerId: 1, text: '[human speech omitted]' },
          { round: 1, phase: 'DAY_DISCUSSION', speakerId: 2, text: 'same line' },
          { round: 2, phase: 'DAY_DISCUSSION', speakerId: 3, text: 'same line' },
        ],
        votes: [
          { round: 1, voterId: 1, targetId: 2 },
          { round: 1, voterId: 2, targetId: 3, reason: 'reason text' },
          { round: 1, voterId: 3, targetId: 2 },
          { round: 2, voterId: 1, targetId: 3 },
          { round: 2, voterId: 3, targetId: 1 },
        ],
        beliefSnapshots: [
          { round: 1, actorId: 2, scores: [{ targetId: 1, score: 0.2 }, { targetId: 3, score: 0.6 }] },
          { round: 2, actorId: 2, scores: [{ targetId: 1, score: 0.5 }, { targetId: 3, score: 0.1 }] },
        ],
      });
      writeFileSync(
        path.join(dir, `${difficulty}-sample.replay.json`),
        `${JSON.stringify(replay, null, 2)}\n`,
        'utf8',
      );
    }
  };

  const runCli = args => execFileSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });

  it('writes byte-identical reports for the same fixtures and stays outside the repo', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'h2d-calibration-'));
    const outA = path.join(dir, 'a.md');
    const outB = path.join(dir, 'b.md');
    try {
      writeFixtureSet(dir);
      const stdoutA = runCli(['--fixtures', dir, '--out', outA]);
      const stdoutB = runCli(['--fixtures', dir, '--out', outB]);
      expect(stdoutB).toBe(stdoutA);
      expect(readFileSync(outA, 'utf8')).toBe(readFileSync(outB, 'utf8'));
      const report = readFileSync(outA, 'utf8');
      expect(report).toContain(SAMPLE_INSUFFICIENT_WARNING);
      expect(report).toContain('speech-repetition-rate');
      // 2 identical AI speeches in each of the 3 games -> 1/2 per difficulty.
      expect(report).toContain('0.500000 (1/2)');
      expect(report).toContain('| easy (Beginner) | 1 |');
      expect(report).toContain('| normal (Intermediate) | 1 |');
      expect(report).toContain('| hard (Expert) | 1 |');
      expect(report).not.toContain(dir);
      expect(report).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with a clear problem when a difficulty directory is missing', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'h2d-calibration-missing-'));
    try {
      writeFixtureSet(dir);
      rmSync(path.join(dir, 'hard'), { recursive: true, force: true });
      let status = 0;
      let stderr = '';
      try {
        runCli(['--fixtures', dir]);
      } catch (error) {
        status = error.status ?? 1;
        stderr = String(error.stderr ?? '');
      }
      expect(status).toBe(1);
      expect(stderr).toContain('difficulty "hard" has no replay fixtures');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
