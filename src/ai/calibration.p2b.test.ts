import { afterEach, describe, expect, it } from 'vitest';
import { MODE_12_PLAYER, MODE_9_PLAYER } from '../constants';
import {
  applyElimination,
  applyNightResolution,
  canWitchSelfSave,
  computeWinner,
  resolveVoteResult,
} from '../gameEngine';
import { DIFFICULTY_CONFIGS, GamePhase, Role, type Player } from '../types';
import { selectAction } from './actionSelector';
import {
  generateAIAction,
  resetAIMemory,
  setAIDifficulty,
  setAIExpressionModel,
} from './aiOrchestrator';
import { BeliefTracker, globalBeliefTracker } from './beliefTracker';
import {
  createOfflineMockStructuredExtractor,
  DEFAULT_EXTRACTOR_EVAL_SAMPLES,
  DEFAULT_LLM_EXTRACTOR_ENABLED,
  evaluateExtractorAB,
  extractSpeechClaimsWithLLM,
  LLM_EXTRACTOR_ADOPTION_GATE,
} from './speechExtractorLLM';
// @ts-expect-error Untyped .mjs calibration CLI module verified directly at runtime
import { computeCampVoteBreakdown, runSeededCalibrationSimulation } from '../../scripts/difficulty-calibration.mjs';

const makePlayers = (roles: readonly Role[]): Player[] =>
  roles.map((role, index) => ({
    id: index + 1,
    name: `Player ${index + 1}`,
    role,
    camp: role === Role.WEREWOLF ? 'WEREWOLF' : 'VILLAGE',
    isAlive: true,
    canVote: true,
    isRevealed: false,
    avatarUrl: '',
    aiPersonality: '',
    traits: [],
    aiModelLabel: 'test',
    isHuman: index === 0,
    isWolfHopper: index === 1 && role === Role.WEREWOLF,
    publicClaims: [],
    privateKnowledge: [],
    suspicionMap: {},
  }));

const BOARD_9 = [
  Role.VILLAGER,
  Role.WEREWOLF,
  Role.WEREWOLF,
  Role.WEREWOLF,
  Role.SEER,
  Role.WITCH,
  Role.HUNTER,
  Role.VILLAGER,
  Role.VILLAGER,
] as const;

afterEach(() => {
  resetAIMemory();
  setAIDifficulty(0.85);
});

describe('P2B AC1: wolfCoordination & mistakeRate wiring in selectAction and aiOrchestrator', () => {
  it('coordinates all living wolves onto the exact same deterministic non-wolf consensus target when wolfCoordination=1', () => {
    const players = makePlayers(BOARD_9);
    const tracker = new BeliefTracker();
    tracker.init(players);
    tracker.updateFromSpeech(5, '我是预言家，昨晚验了2号，2号是查杀。', players, { round: 1, eventId: 'seer-claim-5' });
    tracker.updateFromSpeech(6, '8号有点可疑，先关注8号。', players, { round: 1, eventId: 'witch-accuse-8' });

    const wolves = players.filter(p => p.role === Role.WEREWOLF);
    const targets = wolves.map((wolf, i) =>
      selectAction(wolf, players, tracker, 'VOTE', 1, [], 1.0, {
        rng: () => 0.1 + i * 0.25,
        wolfCoordination: 1.0,
        mistakeRate: 0.08,
        phase: GamePhase.DAY_VOTING,
      }),
    );

    expect(new Set(targets.map(t => t.targetId)).size).toBe(1);
    for (const decision of targets) {
      expect(decision.outcome).toBe('ACT');
      expect(decision.reason).toContain('狼队协同冲票');
      expect([2, 3, 4]).not.toContain(decision.targetId);
    }
  });

  it('disperses uncoordinated wolves across non-wolf candidates when wolfCoordination=0 while still protecting teammates on non-bussing path', () => {
    const players = makePlayers(BOARD_9);
    const tracker = new BeliefTracker();
    tracker.init(players);
    tracker.updateFromSpeech(5, '我是预言家，昨晚验了2号，2号是查杀。', players, { round: 1, eventId: 'seer-claim-5' });

    const wolf = players.find(p => p.id === 3)!;
    const coordinated = selectAction(wolf, players, tracker, 'VOTE', 1, [], 1.0, {
      rng: () => 0.0,
      wolfCoordination: 1.0,
    });
    const uncoordinated = selectAction(wolf, players, tracker, 'VOTE', 1, [], 1.0, {
      rng: () => 0.5,
      wolfCoordination: 0.0,
    });

    expect(uncoordinated.targetId).not.toBe(coordinated.targetId);
    expect([2, 3, 4]).not.toContain(uncoordinated.targetId);
    expect(uncoordinated.reason).toContain('分散');
  });

  it('uses mistakeRate on good-player randomized VOTE so low mistakeRate stays in top-3 suspects while high mistakeRate picks broadly', () => {
    const players = makePlayers(BOARD_9);
    const tracker = new BeliefTracker();
    tracker.init(players);
    // Elevate seats 2, 3, 4 as the clear top-3 suspects for seat 8 (Villager)
    tracker.updateFromSpeech(5, '我是预言家，昨晚验了2号，2号是查杀。', players, { round: 1, eventId: 'c1' });
    tracker.updateFromSpeech(6, '3号和4号像狼，我怀疑3号，我怀疑4号。', players, { round: 1, eventId: 'c2' });
    tracker.updateFromSpeech(7, '我相信9号是好人，我相信1号是好人，我相信5号是好人。', players, { round: 1, eventId: 'c3' });

    const voter = players.find(p => p.id === 8)!;
    // rng sequence: 0.99 (> actionAccuracy 0.92 -> enter difficulty gate), 0.50 (>= mistakeRate 0.08 -> top-3), 0.0 (pick index 0 of top-3)
    const seqHard = [0.99, 0.50, 0.4];
    let idxHard = 0;
    const hardMistake = selectAction(voter, players, tracker, 'VOTE', 1, [], 0.92, {
      rng: () => seqHard[idxHard++] ?? 0,
      mistakeRate: 0.08,
    });
    expect(hardMistake.randomized).toBe(true);
    expect([2, 3, 4]).toContain(hardMistake.targetId);
    expect(hardMistake.reason).toContain('次优候选');

    // rng sequence: 0.99 (> actionAccuracy 0.45), 0.10 (< mistakeRate 0.55 -> broad uniform), 0.99 (last seat in legalPool = 9)
    const seqEasy = [0.99, 0.10, 0.99];
    let idxEasy = 0;
    const easyMistake = selectAction(voter, players, tracker, 'VOTE', 1, [], 0.45, {
      rng: () => seqEasy[idxEasy++] ?? 0.99,
      mistakeRate: 0.55,
    });
    expect(easyMistake.randomized).toBe(true);
    expect(easyMistake.targetId).toBe(9);
  });

  it('threads wolfCoordination and mistakeRate from setAIDifficulty and setAIExpressionModel through generateAIAction', async () => {
    const players = makePlayers(BOARD_9);
    globalBeliefTracker.init(players);
    globalBeliefTracker.updateFromSpeech(5, '我是预言家，昨晚验了2号，2号是查杀。', players, { round: 1, eventId: 'orch-seer-5' });

    setAIExpressionModel('gemini-3.6-flash', 'hard');
    setAIDifficulty(DIFFICULTY_CONFIGS.hard.actionAccuracy);

    const wolves = players.filter(p => p.role === Role.WEREWOLF);
    const decisions = [];
    for (const wolf of wolves) {
      decisions.push(
        await generateAIAction(wolf, players, [], 'VOTE', [], 1, {
          rng: () => 0.1,
          deferVoteBeliefUpdate: true,
        }),
      );
    }

    expect(new Set(decisions.map(d => d.targetId)).size).toBe(1);
    expect(decisions.every(d => d.reason.includes('狼队协同冲票'))).toBe(true);
  });
});

describe('P2B AC1 & AC2: camp vote breakdown and 30-game/tier (90 total, 9p+12p) seeded calibration simulation', () => {
  it('computes goodAiVoteHitWolfRate, wolfTeammateProtectionRate, and wolfVoteConcentration accurately', () => {
    const breakdown = computeCampVoteBreakdown({
      players: [
        { seat: 1, role: 'Villager', isHuman: true },
        { seat: 2, role: 'Werewolf', isHuman: false },
        { seat: 3, role: 'Werewolf', isHuman: false },
        { seat: 4, role: 'Seer', isHuman: false },
        { seat: 5, role: 'Villager', isHuman: false },
      ],
      votes: [
        { round: 1, voterId: 1, targetId: 2 }, // human -> excluded
        { round: 1, voterId: 2, targetId: 4 }, // wolf -> non-wolf
        { round: 1, voterId: 3, targetId: 4 }, // wolf -> non-wolf (same target -> conc 1.0)
        { round: 1, voterId: 4, targetId: 2 }, // good -> wolf (hit)
        { round: 1, voterId: 5, targetId: 4 }, // good -> good (miss)
        { round: 2, voterId: 2, targetId: 3 }, // wolf -> teammate (unprotected)
        { round: 2, voterId: 3, targetId: 5 }, // wolf -> non-wolf (split -> conc 0.5)
      ],
    });

    expect(breakdown.goodAiVotes).toBe(2);
    expect(breakdown.goodAiVotesOnWolf).toBe(1);
    expect(breakdown.goodAiVoteHitWolfRate).toBeCloseTo(0.5, 6);
    expect(breakdown.wolfAiVotes).toBe(4);
    expect(breakdown.wolfAiVotesOnNonWolf).toBe(3);
    expect(breakdown.wolfTeammateProtectionRate).toBeCloseTo(0.75, 6);
    expect(breakdown.wolfConcentrationRounds).toBe(2);
    expect(breakdown.wolfVoteConcentration).toBeCloseTo(0.75, 6);
  });

  it('verifies monotonic separation across easy/normal/hard on n=30 games/tier (90 games, 9p+12p) with zero illegal actions or unauthorized reads', () => {
    const sim = runSeededCalibrationSimulation(
      {
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
        MODE_9_PLAYER,
        MODE_12_PLAYER,
      },
      { gamesPerTier: 30, baseSeed: 20261124 },
    );

    expect(sim.gamesPerTier).toBe(30);
    expect(sim.totalGames).toBe(90);

    for (const tier of ['easy', 'normal', 'hard'] as const) {
      const t = sim.optimized[tier];
      expect(t.games).toBe(30);
      expect(t.boardCounts['9-standard']).toBe(15);
      expect(t.boardCounts['12-standard']).toBe(15);
      expect(t.illegalActionRate).toBe(0);
      expect(t.unauthorizedInfoReadRate).toBe(0);
      expect(t.fallbackRate).toBe(0);
      expect(t.roleActionDistribution.KILL).toBeGreaterThan(0);
      expect(t.roleActionDistribution.CHECK).toBeGreaterThan(0);
      expect(t.roleActionDistribution.VOTE).toBeGreaterThan(0);
      expect(t.latencyMs.p95).toBeGreaterThanOrEqual(t.latencyMs.p50);
    }

    const { easy, normal, hard } = sim.optimized;
    // Strictly monotonic goodAiVoteHitWolfRate: hard > normal > easy
    expect(hard.goodAiVoteHitWolfRate).toBeGreaterThan(normal.goodAiVoteHitWolfRate!);
    expect(normal.goodAiVoteHitWolfRate).toBeGreaterThan(easy.goodAiVoteHitWolfRate!);
    // Monotonic wolfTeammateProtectionRate: hard >= normal >= easy (and hard > easy)
    expect(hard.wolfTeammateProtectionRate).toBeGreaterThanOrEqual(normal.wolfTeammateProtectionRate!);
    expect(normal.wolfTeammateProtectionRate).toBeGreaterThanOrEqual(easy.wolfTeammateProtectionRate!);
    expect(hard.wolfTeammateProtectionRate).toBeGreaterThan(easy.wolfTeammateProtectionRate!);
    // Strictly monotonic wolfVoteConcentration: hard > normal > easy
    expect(hard.wolfVoteConcentration).toBeGreaterThan(normal.wolfVoteConcentration!);
    expect(normal.wolfVoteConcentration).toBeGreaterThan(easy.wolfVoteConcentration!);

    expect(sim.monotonicity.goodAiVoteHitWolfRate).toBe(true);
    expect(sim.monotonicity.wolfTeammateProtectionRate).toBe(true);
    expect(sim.monotonicity.wolfVoteConcentration).toBe(true);

    // Wiring wolfCoordination & mistakeRate must improve hard-tier wolf concentration over unwired baseline
    expect(sim.optimized.hard.wolfVoteConcentration!).toBeGreaterThan(
      sim.baseline.hard.wolfVoteConcentration!,
    );

    // At least 3 annotated replay walkthroughs with concrete steps
    expect(sim.walkthroughs.length).toBeGreaterThanOrEqual(3);
    for (const walkthrough of sim.walkthroughs) {
      expect(walkthrough.steps.length).toBeGreaterThan(0);
    }
  });
});

describe('P2B AC3: Opt-in LLM structured evidence extractor safety, fallback, and offline A/B benchmark', () => {
  const players = makePlayers(BOARD_9);

  it('is OFF by default and falls back directly to deterministic P1A parseSpeechEvidence with zero LLM cost', async () => {
    expect(DEFAULT_LLM_EXTRACTOR_ENABLED).toBe(false);
    let called = false;
    const res = await extractSpeechClaimsWithLLM(
      '我是预言家，昨晚验了2号，2号是查杀。',
      5,
      players,
      {
        extractor: () => {
          called = true;
          return '{"claims":[]}';
        },
      },
    );
    expect(called).toBe(false);
    expect(res.source).toBe('fallback-rule');
    expect(res.fallbackReason).toBe('disabled');
    expect(res.estimatedCostUSD).toBe(0);
    expect(res.claims).toHaveLength(1);
    expect(res.claims[0]).toMatchObject({ targetId: 2, polarity: 'check-wolf' });
  });

  it('validates schema, discards quoted/self/out-of-roster/invalid-polarity claims, clamps confidence, and deduplicates', async () => {
    const res = await extractSpeechClaimsWithLLM(
      '5号说6号是狼，但其实2号才可疑，而且我支持7号。',
      8,
      players,
      {
        enabled: true,
        extractor: () =>
          JSON.stringify({
            claims: [
              { targetId: 6, polarity: 'accuse', confidence: 0.9, quoted: true, clause: '5号说6号是狼' },
              { targetId: 8, polarity: 'defend', confidence: 0.9, quoted: false, clause: 'self' },
              { targetId: 99, polarity: 'accuse', confidence: 0.9, quoted: false, clause: 'ghost' },
              { targetId: 3, polarity: 'kill-now', confidence: 0.9, quoted: false, clause: 'bad-polarity' },
              { targetId: 2, polarity: 'accuse', confidence: 0.6, quoted: false, clause: '2号可疑-弱' },
              { targetId: 2, polarity: 'accuse', confidence: 1.7, quoted: false, clause: '2号可疑-强' },
              { targetId: 7, polarity: 'defend', confidence: 0.82, quoted: false, clause: '支持7号' },
            ],
            roleClaims: [
              { claimedRole: 'Werewolf', confidence: 0.9, clause: 'invalid public role' },
              { claimedRole: 'Villager', confidence: 0.8, clause: '我是平民' },
            ],
          }),
      },
    );

    expect(res.source).toBe('llm-structured');
    expect(res.discardedClaimsCount).toBe(4);
    expect(res.suppressedClauses).toEqual(['5号说6号是狼']);
    expect(res.claims).toHaveLength(2);
    expect(res.claims.find(c => c.targetId === 2)).toMatchObject({
      polarity: 'accuse',
      confidence: 1,
    });
    expect(res.claims.find(c => c.targetId === 7)).toMatchObject({
      polarity: 'defend',
      confidence: 0.82,
    });
    expect(res.roleClaims).toHaveLength(1);
    expect(res.roleClaims[0].claimedRole).toBe(Role.VILLAGER);
    expect(res.estimatedTokens).toBeGreaterThan(0);
    expect(res.estimatedCostUSD).toBeGreaterThan(0);
  });

  it('safely falls back to P1A rule parser on malformed JSON, invalid schema, timeout, and provider throw with zero uncaught errors', async () => {
    const speech = '2号是狼，今天投2号。';

    const malformed = await extractSpeechClaimsWithLLM(speech, 5, players, {
      enabled: true,
      extractor: () => 'not valid json {{{',
    });
    expect(malformed.source).toBe('fallback-rule');
    expect(malformed.fallbackReason).toBe('invalid-json');
    expect(malformed.claims[0]).toMatchObject({ targetId: 2, polarity: 'accuse' });

    const badSchema = await extractSpeechClaimsWithLLM(speech, 5, players, {
      enabled: true,
      extractor: () => JSON.stringify({ claims: [{ targetId: 99, polarity: 'invalid', confidence: 0.9 }] }),
    });
    expect(badSchema.source).toBe('fallback-rule');
    expect(badSchema.fallbackReason).toBe('schema-invalid');
    expect(badSchema.claims[0]).toMatchObject({ targetId: 2, polarity: 'accuse' });

    const threw = await extractSpeechClaimsWithLLM(speech, 5, players, {
      enabled: true,
      extractor: async () => {
        throw new Error('simulated provider outage');
      },
    });
    expect(threw.source).toBe('fallback-rule');
    expect(threw.fallbackReason).toBe('provider-error');
    expect(threw.claims[0]).toMatchObject({ targetId: 2, polarity: 'accuse' });

    const timedOut = await extractSpeechClaimsWithLLM(speech, 5, players, {
      enabled: true,
      timeoutMs: 25,
      extractor: () => new Promise(resolve => setTimeout(() => resolve('{"claims":[]}'), 200)),
    });
    expect(timedOut.source).toBe('fallback-rule');
    expect(timedOut.fallbackReason).toBe('timeout');
    expect(timedOut.claims[0]).toMatchObject({ targetId: 2, polarity: 'accuse' });
  });

  it('evaluates P1A rule parser vs mocked structured LLM extractor A/B metrics and checks adoption thresholds', async () => {
    const ab = await evaluateExtractorAB(
      DEFAULT_EXTRACTOR_EVAL_SAMPLES,
      createOfflineMockStructuredExtractor(),
      { speechesPerMatch: 24 },
    );

    expect(ab.sampleCount).toBe(DEFAULT_EXTRACTOR_EVAL_SAMPLES.length);
    expect(ab.ruleParser.f1).toBeGreaterThan(0);
    expect(ab.llmExtractor.f1).toBeGreaterThan(ab.ruleParser.f1);
    expect(ab.f1Delta).toBeGreaterThanOrEqual(LLM_EXTRACTOR_ADOPTION_GATE.minF1Delta);
    expect(ab.llmExtractor.fallbackRate).toBeLessThan(LLM_EXTRACTOR_ADOPTION_GATE.maxFallbackRate);
    expect(ab.llmExtractor.estimatedCostPerMatchUSD).toBeLessThanOrEqual(
      LLM_EXTRACTOR_ADOPTION_GATE.maxCostPerMatchUSD,
    );
    expect(ab.adoptionGate.passed).toBe(true);

    // Failing gate check: high fallback rate fails adoption gate cleanly
    const brokenAb = await evaluateExtractorAB(
      DEFAULT_EXTRACTOR_EVAL_SAMPLES,
      () => 'corrupted-json',
    );
    expect(brokenAb.llmExtractor.fallbackRate).toBe(1);
    expect(brokenAb.adoptionGate.fallbackRatePassed).toBe(false);
    expect(brokenAb.adoptionGate.passed).toBe(false);
  });
});
