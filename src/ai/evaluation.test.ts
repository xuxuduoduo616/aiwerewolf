import { describe, expect, it } from 'vitest';
import { Role, type Player } from '../types';
import {
  createMockProvider,
  detectInfoLeakage,
  estimateEvalCostUSD,
  estimateTokens,
  runReplay,
  type ReplayInput,
  type ScriptedTurn,
} from './evaluation';

// ─── fixtures ────────────────────────────────────────────────────────────────

const makePlayer = (id: number, role: Role, overrides: Partial<Player> = {}): Player => ({
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
  isHuman: false,
  publicClaims: [],
  privateKnowledge: [],
  suspicionMap: {},
  ...overrides,
});

const makePlayers = (): Player[] => [
  makePlayer(1, Role.WEREWOLF),
  makePlayer(2, Role.WEREWOLF),
  makePlayer(3, Role.SEER),
  makePlayer(4, Role.WITCH),
  makePlayer(5, Role.HUNTER),
  makePlayer(6, Role.VILLAGER),
  makePlayer(7, Role.VILLAGER),
];

const CLEAN_TURNS: ScriptedTurn[] = [
  { kind: 'speech', round: 1, actorId: 6, speech: '我先听3号的发言，再决定站边。' },
  { kind: 'speech', round: 1, actorId: 1, speech: '5号的发言太飘了，我建议今天投他。' },
  { kind: 'speech', round: 1, actorId: 3, speech: '我是预言家，昨晚验了1号，是查杀。' },
  { kind: 'action', round: 1, actorId: 1, actionType: 'KILL', proposedTargetId: 3 },
  { kind: 'action', round: 1, actorId: 6, actionType: 'VOTE', proposedTargetId: 1 },
  { kind: 'action', round: 1, actorId: 4, actionType: 'POISON', proposedTargetId: null },
];

const cleanInput = (): ReplayInput => ({
  gameId: 'eval-clean-0001',
  players: makePlayers(),
  turns: CLEAN_TURNS,
  variant: 'balanced',
});

// ─── mock provider + cost estimator ─────────────────────────────────────────

describe('evaluation mock provider', () => {
  it('echoes the scripted response deterministically and records calls', () => {
    const provider = createMockProvider();
    expect(provider.complete('prompt-a', 'response-a')).toBe('response-a');
    expect(provider.complete('prompt-b', 'response-b')).toBe('response-b');
    expect(provider.calls).toEqual([
      { prompt: 'prompt-a', response: 'response-a' },
      { prompt: 'prompt-b', response: 'response-b' },
    ]);
  });
});

describe('evaluation cost estimator', () => {
  it('uses the ~4 chars/token heuristic', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('computes cost from prompt + response tokens at a per-1k rate', () => {
    const calls = [{ prompt: 'aaaa', response: 'bbbb' }];
    expect(estimateEvalCostUSD(calls, 0.5)).toBeCloseTo(0.001, 10);
    expect(estimateEvalCostUSD(calls, 0)).toBe(0);
  });
});

// ─── info-leakage detector ───────────────────────────────────────────────────

describe('info-leakage detector', () => {
  const [wolf, , seer, witch, , villager] = makePlayers();

  it('flags a wolf revealing teammates', () => {
    expect(detectInfoLeakage(wolf, '我和2号是队友，别投我们。')).toContain('wolf-teammate-reveal');
  });

  it('flags a wolf self-reveal', () => {
    expect(detectInfoLeakage(wolf, '其实我就是狼，你们别猜了。')).toContain('wolf-self-reveal');
  });

  it('flags a non-seer stating check results', () => {
    expect(detectInfoLeakage(villager, '我昨晚验了2号，是查杀。')).toContain('non-seer-check-claim');
  });

  it('flags the witch revealing potion state', () => {
    expect(detectInfoLeakage(witch, '我还留着解药和毒药。')).toContain('witch-potion-reveal');
  });

  it('does not flag a true seer reporting checks', () => {
    expect(detectInfoLeakage(seer, '我是预言家，昨晚验了1号，是查杀。')).toEqual([]);
  });

  it('passes ordinary clean speech', () => {
    expect(detectInfoLeakage(villager, '今天先盘票型，再看5号的逻辑。')).toEqual([]);
  });
});

// ─── replay runner ───────────────────────────────────────────────────────────

describe('replay runner', () => {
  it('clean fixture yields zero illegal, leakage, and repetition, zero mock cost', () => {
    const report = runReplay(cleanInput());
    expect(report.gameId).toBe('eval-clean-0001');
    expect(report.variant).toBe('balanced');
    expect(report.speechTurns).toBe(3);
    expect(report.actionTurns).toBe(3);
    expect(report.illegalActionRate).toBe(0);
    expect(report.infoLeakageRate).toBe(0);
    expect(report.speechRepetitionRate).toBe(0);
    expect(report.estimatedCostUSD).toBe(0);
    expect(report.leakageFindings).toEqual([]);
    expect(report.illegalActions).toEqual([]);
  });

  it('is fully deterministic: repeated runs yield identical reports', () => {
    const a = runReplay(cleanInput());
    const b = runReplay(cleanInput());
    expect(b).toEqual(a);
  });

  it('accepts valid proposed actions and lets the real selector decide passes', () => {
    const report = runReplay(cleanInput());
    expect(report.resolvedActions).toHaveLength(3);
    const [kill, vote, poison] = report.resolvedActions;
    expect(kill).toMatchObject({ actionType: 'KILL', targetId: 3, source: 'proposed' });
    expect(vote).toMatchObject({ actionType: 'VOTE', targetId: 1, source: 'proposed' });
    // Witch beliefs are all 0.5 (< 0.7 threshold) → real selector declines to poison.
    expect(poison).toMatchObject({ actionType: 'POISON', targetId: null, source: 'selector' });
  });

  it('rejects illegal proposals and falls back to the real actionSelector', () => {
    const turns: ScriptedTurn[] = [
      // Wolf proposes killing a wolf teammate — rejected by the validity filter.
      { kind: 'action', round: 1, actorId: 1, actionType: 'KILL', proposedTargetId: 2 },
      // Vote for a nonexistent player — rejected.
      { kind: 'action', round: 1, actorId: 6, actionType: 'VOTE', proposedTargetId: 99 },
      // Legal vote.
      { kind: 'action', round: 1, actorId: 7, actionType: 'VOTE', proposedTargetId: 3 },
    ];
    const report = runReplay({ gameId: 'eval-illegal-0001', players: makePlayers(), turns, variant: 'balanced' });
    expect(report.illegalActionRate).toBeCloseTo(2 / 3, 10);
    expect(report.illegalActions).toEqual([
      { round: 1, actorId: 1, actionType: 'KILL', proposedTargetId: 2 },
      { round: 1, actorId: 6, actionType: 'VOTE', proposedTargetId: 99 },
    ]);
    // Selector fallbacks pick real, legal targets (wolf beliefs: teammates 0.05, others 0.5).
    const [kill, vote1, vote2] = report.resolvedActions;
    expect(kill).toMatchObject({ targetId: 3, source: 'selector' });
    expect(vote1).toMatchObject({ targetId: 1, source: 'selector' });
    expect(vote2).toMatchObject({ targetId: 3, source: 'proposed' });
  });

  it('rejects votes targeting dead players', () => {
    const players = makePlayers();
    players[4].isAlive = false; // player 5 dead
    const turns: ScriptedTurn[] = [
      { kind: 'action', round: 2, actorId: 6, actionType: 'VOTE', proposedTargetId: 5 },
    ];
    const report = runReplay({ gameId: 'eval-dead-0001', players, turns, variant: 'balanced' });
    expect(report.illegalActionRate).toBe(1);
    expect(report.resolvedActions[0].source).toBe('selector');
    expect(report.resolvedActions[0].targetId).not.toBe(5);
  });

  it('measures info leakage across speeches', () => {
    const turns: ScriptedTurn[] = [
      { kind: 'speech', round: 1, actorId: 1, speech: '我和2号是队友，别投我们。' },
      { kind: 'speech', round: 1, actorId: 6, speech: '我昨晚验了2号，是查杀。' },
      { kind: 'speech', round: 1, actorId: 4, speech: '我还留着解药和毒药。' },
      { kind: 'speech', round: 1, actorId: 7, speech: '今天先盘票型。' },
    ];
    const report = runReplay({ gameId: 'eval-leaky-0001', players: makePlayers(), turns, variant: 'balanced' });
    expect(report.infoLeakageRate).toBeCloseTo(3 / 4, 10);
    expect(report.leakageFindings.map(f => f.ruleId)).toEqual([
      'wolf-teammate-reveal',
      'non-seer-check-claim',
      'witch-potion-reveal',
    ]);
  });

  it('measures speech repetition across turns', () => {
    const turns: ScriptedTurn[] = [
      { kind: 'speech', round: 1, actorId: 6, speech: '今天先盘票型。' },
      { kind: 'speech', round: 1, actorId: 7, speech: '今天先盘票型。' },
      { kind: 'speech', round: 1, actorId: 3, speech: '我先听大家的发言。' },
    ];
    const report = runReplay({ gameId: 'eval-repeat-0001', players: makePlayers(), turns, variant: 'balanced' });
    expect(report.speechRepetitionRate).toBeCloseTo(1 / 3, 10);
  });

  it('exercises the cost estimator with a nonzero per-1k rate', () => {
    const provider = createMockProvider();
    const report = runReplay({ ...cleanInput(), provider, costPer1kTokens: 0.00015 });
    expect(report.estimatedCostUSD).toBeGreaterThan(0);
    expect(report.estimatedCostUSD).toBeCloseTo(estimateEvalCostUSD(provider.calls, 0.00015), 10);
  });

  it('threads the behavior variant into provider prompts', () => {
    const cautious = createMockProvider();
    const aggressive = createMockProvider();
    runReplay({ ...cleanInput(), variant: 'cautious', provider: cautious });
    runReplay({ ...cleanInput(), variant: 'aggressive', provider: aggressive });
    expect(cautious.calls).toHaveLength(3);
    expect(aggressive.calls).toHaveLength(3);
    expect(cautious.calls[0].prompt).toContain('cautious');
    expect(aggressive.calls[0].prompt).toContain('aggressive');
    expect(cautious.calls[0].prompt).not.toBe(aggressive.calls[0].prompt);
  });

  it('throws on fixtures referencing unknown players', () => {
    const turns: ScriptedTurn[] = [
      { kind: 'speech', round: 1, actorId: 42, speech: '……' },
    ];
    expect(() =>
      runReplay({ gameId: 'eval-bad-0001', players: makePlayers(), turns, variant: 'balanced' }),
    ).toThrow(/unknown player 42/);
  });
});
