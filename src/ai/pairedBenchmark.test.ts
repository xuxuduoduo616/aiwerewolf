import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Role, type Player } from '../types';
import { loadBenchmarkFixtures } from './benchmarkFixtures';
import {
  LEAKAGE_RULES,
  MULTILINGUAL_LEAKAGE_RULES,
  detectInfoLeakage,
  runReplay,
  type ScriptedTurn,
} from './evaluation';
import {
  checkPairedBenchmarkReport,
  createSeededRng,
  formatPairedBenchmarkJson,
  formatPairedBenchmarkMarkdown,
  loadPairedCases,
  runCounterfactualPolicyComparison,
  runPairedBenchmark,
  toDeterministicPairedReport,
} from './pairedBenchmark';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '..', '..');
const CLI_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'ai-decision-eval.mjs');

const LISTEN_GUARD_SOURCE = `
const net = require('node:net');
const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  console.error('[NET-GUARD] listen', JSON.stringify(args.map(arg => (typeof arg === 'object' ? '[object]' : arg))));
  return originalListen.apply(this, args);
};
`;

const makePlayer = (id: number, role: Role): Player => ({
  id,
  name: `P${id}`,
  role,
  camp: role === Role.WEREWOLF ? 'WEREWOLF' : 'VILLAGE',
  isAlive: true,
  canVote: true,
  isRevealed: false,
  avatarUrl: '',
  aiPersonality: '',
  traits: [],
  aiModelLabel: '',
  isHuman: id === 1,
  publicClaims: [],
  privateKnowledge: [],
  suspicionMap: {},
});

describe('createSeededRng', () => {
  it('is strictly deterministic for identical seeds and bounded in [0, 1)', () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('Paired Evidence Sensitivity Benchmark (P1–P9)', () => {
  it('passes all 9 paired cases deterministically with zero illegal, fallback, or unauthorized reads', async () => {
    const dataset = loadPairedCases();
    expect(dataset.cases.map(c => c.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9']);

    const first = await runPairedBenchmark(dataset);
    const second = await runPairedBenchmark(dataset);

    expect(first.summary.casesTotal).toBe(9);
    expect(first.summary.casesPassed).toBe(9);
    for (const c of first.cases) {
      expect(c.passed, `${c.id} failures: ${c.failures.join('; ')}`).toBe(true);
    }

    expect(first.summary.evidenceSensitivityRate).toBe(1);
    expect(first.summary.illegalActionRate).toBe(0);
    expect(first.summary.unauthorizedInfoReadRate).toBe(0);
    expect(first.summary.fallbackRate).toBe(0);
    expect(first.summary.tieBreakUniformity).toBeGreaterThanOrEqual(0.85);
    expect(first.summary.tieBreakRate).toBeGreaterThan(0);

    // Every action bucket in roleActionDistribution is genuinely exercised
    const dist = first.summary.roleActionDistribution;
    expect(dist.VOTE).toBeGreaterThan(0);
    expect(dist.KILL).toBeGreaterThan(0);
    expect(dist.CHECK).toBeGreaterThan(0);
    expect(dist.POISON).toBeGreaterThan(0);
    expect(dist.HOLD).toBeGreaterThan(0);
    expect(dist.SAVE).toBeGreaterThan(0);
    expect(dist.SHOOT).toBeGreaterThan(0);

    // Latency stats are non-negative and monotonic
    expect(first.summary.decisionLatencyMs.p50).toBeGreaterThanOrEqual(0);
    expect(first.summary.decisionLatencyMs.p95).toBeGreaterThanOrEqual(first.summary.decisionLatencyMs.p50);
    expect(first.summary.decisionLatencyMs.max).toBeGreaterThanOrEqual(first.summary.decisionLatencyMs.p95);

    // Byte-identical deterministic payload across two independent runs
    expect(toDeterministicPairedReport(second)).toEqual(toDeterministicPairedReport(first));
    expect(formatPairedBenchmarkJson(second, { deterministic: true })).toBe(
      formatPairedBenchmarkJson(first, { deterministic: true }),
    );

    const gate = checkPairedBenchmarkReport(first, second);
    expect(gate.ok).toBe(true);
    expect(gate.problems).toEqual([]);

    const md = formatPairedBenchmarkMarkdown(first);
    expect(md).toContain('9/9');
    expect(md).toContain('| P1 | PASS |');
    expect(md).toContain('| P9 | PASS |');
  });
});

describe('Multilingual leakage detection & counterfactual replay diff in evaluation.ts', () => {
  const players = [
    makePlayer(1, Role.VILLAGER),
    makePlayer(2, Role.WEREWOLF),
    makePlayer(3, Role.WEREWOLF),
    makePlayer(4, Role.SEER),
    makePlayer(5, Role.WITCH),
    makePlayer(6, Role.HUNTER),
  ];
  const [villager, wolf, , seer, witch] = players;

  it('keeps legacy LEAKAGE_RULES unchanged while MULTILINGUAL_LEAKAGE_RULES catches zh/en/ja leaks', () => {
    expect(MULTILINGUAL_LEAKAGE_RULES.length).toBeGreaterThan(LEAKAGE_RULES.length);

    // English leaks caught only in multilingual mode
    expect(detectInfoLeakage(wolf, 'I am a werewolf, vote me.')).toEqual([]);
    expect(detectInfoLeakage(wolf, 'I am a werewolf, vote me.', { multilingual: true })).toContain('wolf-self-reveal-en');
    expect(detectInfoLeakage(wolf, 'Player 3 is my wolf teammate.', { multilingual: true })).toContain('wolf-teammate-reveal-en');
    expect(detectInfoLeakage(villager, 'I am the seer and I checked Player 2.', { multilingual: true })).toContain('non-seer-check-claim-en');
    expect(detectInfoLeakage(witch, 'I used my antidote and I saved Player 1.', { multilingual: true })).toContain('witch-potion-reveal-en');
    expect(detectInfoLeakage(witch, 'I poisoned Player 2 last night.', { multilingual: true })).toContain('witch-potion-reveal-en');

    // Japanese leaks caught only in multilingual mode
    expect(detectInfoLeakage(wolf, '実は人狼です。')).toEqual([]);
    expect(detectInfoLeakage(wolf, '実は人狼です。', { multilingual: true })).toContain('wolf-self-reveal-ja');
    expect(detectInfoLeakage(wolf, '襲撃はアキでどうです？', { multilingual: true })).toContain('wolf-teammate-reveal-ja');
    expect(detectInfoLeakage(witch, 'あの人を占って、人間だった！', { multilingual: true })).toContain('non-seer-check-claim-ja');

    // True Seer and clean speeches stay clean across all languages
    expect(detectInfoLeakage(seer, 'I am the seer and I checked Player 2.', { multilingual: true })).toEqual([]);
    expect(detectInfoLeakage(seer, '私は自分が占い師だと知っている。', { multilingual: true })).toEqual([]);
    expect(detectInfoLeakage(wolf, 'I am not a wolf, Player 6 is suspicious.', { multilingual: true })).toEqual([]);
    expect(detectInfoLeakage(villager, 'Player 2 looks suspicious today.', { multilingual: true })).toEqual([]);
  });

  it('tracks counterfactual selector divergence cleanly only when opted in', () => {
    const turns: ScriptedTurn[] = [
      { kind: 'speech', round: 1, actorId: 4, speech: '我是预言家，昨晚验了2号，是查杀。' },
      // Proposed vote picks 6 even though selector wants 2 -> diverged = true
      { kind: 'action', round: 1, actorId: 1, actionType: 'VOTE', proposedTargetId: 6 },
      // Proposed vote matches selector target 2 -> diverged = false
      { kind: 'action', round: 1, actorId: 6, actionType: 'VOTE', proposedTargetId: 2 },
    ];

    const defaultReport = runReplay({
      gameId: 'cf-default',
      players,
      turns,
      variant: 'balanced',
    });
    expect(defaultReport.counterfactualComparisons).toBeUndefined();

    const cfSummary = runCounterfactualPolicyComparison({
      gameId: 'cf-tracked',
      players,
      turns,
      variant: 'balanced',
    });
    expect(cfSummary.totalActions).toBe(2);
    expect(cfSummary.divergedCount).toBe(1);
    expect(cfSummary.agreedCount).toBe(1);
    expect(cfSummary.divergenceRate).toBe(0.5);
    expect(cfSummary.agreementRate).toBe(0.5);
    expect(cfSummary.comparisons[0]).toMatchObject({
      actorId: 1,
      proposedTargetId: 6,
      selectorTargetId: 2,
      diverged: true,
    });
    expect(cfSummary.comparisons[1]).toMatchObject({
      actorId: 6,
      proposedTargetId: 2,
      selectorTargetId: 2,
      diverged: false,
    });
  });

  it('detects Japanese leakage in committed local-9p-001 when multilingualLeakage is opted in without affecting H2-C default', () => {
    const fixtures = loadBenchmarkFixtures();
    const nine001 = fixtures.find(f => f.id === 'local-9p-001')!;
    // H2-C default remains strictly 0
    expect(nine001.result.infoLeakageRate).toBe(0);

    // Opt-in multilingual audit catches the Japanese wolf night-attack & non-seer check leaks
    const playersFromFixture = nine001.replay.players.map(seat => ({
      ...makePlayer(seat.seat, seat.role),
      isHuman: seat.isHuman,
    }));
    const humanSeats = new Set(nine001.replay.players.filter(p => p.isHuman).map(p => p.seat));
    const speechTurns: ScriptedTurn[] = nine001.replay.speeches
      .filter(s => !humanSeats.has(s.speakerId))
      .map(s => ({ kind: 'speech', round: s.round, actorId: s.speakerId, speech: s.text }));

    const multiReport = runReplay({
      gameId: 'local-9p-001-multilingual',
      players: playersFromFixture,
      turns: speechTurns,
      variant: 'balanced',
      multilingualLeakage: true,
    });
    expect(multiReport.infoLeakageRate).toBeGreaterThan(0);
    expect(multiReport.leakageFindings.map(f => f.ruleId)).toContain('wolf-teammate-reveal-ja');
    expect(multiReport.leakageFindings.map(f => f.ruleId)).toContain('non-seer-check-claim-ja');
  });
});

describe('scripts/ai-decision-eval.mjs CLI', () => {
  const runCli = (args: string[]) =>
    execFileSync(process.execPath, [CLI_SCRIPT_PATH, ...args], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });

  it('--check exits 0, reports 9/9 PASS, and never listens on a TCP port', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'p2a-listen-guard-'));
    const guardPath = path.join(dir, 'guard.cjs');
    writeFileSync(guardPath, LISTEN_GUARD_SOURCE);
    try {
      const result = spawnSync(process.execPath, ['--require', guardPath, CLI_SCRIPT_PATH, '--check'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ai-decision-eval check: PASS (9/9 paired cases');
      expect(result.stderr).not.toContain('[NET-GUARD] listen');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--json --deterministic produces valid byte-stable JSON and default mode outputs Markdown', () => {
    const jsonOut = runCli(['--json', '--deterministic']);
    const parsed = JSON.parse(jsonOut) as { summary: { casesPassed: number; casesTotal: number }; cases: unknown[] };
    expect(parsed.summary.casesPassed).toBe(9);
    expect(parsed.summary.casesTotal).toBe(9);
    expect(parsed.cases).toHaveLength(9);
    expect(jsonOut).not.toContain(REPO_ROOT);

    const mdOut = runCli([]);
    expect(mdOut).toContain('# AI Decision Paired Benchmark Report');
    expect(mdOut).toContain('| Paired cases passed | 9/9 |');
  });
});
