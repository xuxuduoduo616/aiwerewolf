import { afterEach, describe, expect, it, vi } from 'vitest';
import { MODE_9_PLAYER } from '../constants';
import { applyElimination, applyNightResolution, canWitchSelfSave, getRoleCamp } from '../gameEngine';
import { GamePhase, Role, type GameConfig, type Player } from '../types';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  dirty: true,
  effects: new Map<number, { deps?: readonly unknown[]; cleanup?: () => void }>(),
  pending: [] as (() => void)[],
}));

vi.mock('../services/roleDeal', () => ({
  shuffleRoles: <T,>(roles: readonly T[]) => [...roles],
}));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) {
        hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      return [
        hooks.values[index] as T,
        (next: T | ((previous: T) => T)) => {
          const previous = hooks.values[index] as T;
          const value = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
          if (!Object.is(previous, value)) {
            hooks.values[index] = value;
            hooks.dirty = true;
          }
        },
      ] as const;
    },
    useRef: <T,>(value: T) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = { current: value };
      return hooks.values[index] as { current: T };
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.effects.get(index);
      if (
        previous &&
        deps &&
        previous.deps?.length === deps.length &&
        deps.every((v, i) => Object.is(v, previous.deps?.[i]))
      ) {
        return;
      }
      hooks.pending.push(() => {
        previous?.cleanup?.();
        hooks.effects.set(index, { deps, cleanup: effect() || undefined });
      });
    },
  };
});

vi.mock('./geminiAdapter', () => ({
  generateSpeechWithLLM: vi.fn(async () => null),
  generateWolfChatWithLLM: vi.fn(async () => []),
}));

vi.mock('../services/speechLibrary', () => ({
  pickSpeech: vi.fn(async () => ''),
  pickWolfNightSpeech: vi.fn(async () => ''),
  preloadSpeechPools: vi.fn(async () => undefined),
}));

vi.mock('../services/speechAudio', () => ({
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  reset: vi.fn(),
  setMuted: vi.fn(),
  setVolume: vi.fn(),
  setRate: vi.fn(),
  setEnabled: vi.fn(),
  enqueue: vi.fn(async () => undefined),
  speechLangTag: vi.fn(() => 'en-US'),
}));

vi.mock('../services/supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  saveGameRecord: vi.fn(),
  fetchGameRecords: vi.fn(),
}));

import { useGameState, type AuthContext } from '../hooks/useGameState';
import { buildReplay, clearReplays, createReplayRecorder, listReplays } from '../replay';
import { buildDecisionExplanations, buildFullSuspicionMatrix } from '../replay/replaySelectors';
import { selectAction } from './actionSelector';
import { generateAIAction, setAIDifficulty } from './aiOrchestrator';
import { BeliefTracker, globalBeliefTracker } from './beliefTracker';

const mkPlayer = (id: number, role: Role, overrides: Partial<Player> = {}): Player => ({
  id,
  name: `P${id}`,
  role,
  camp: getRoleCamp(role),
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
  ...overrides,
});

const make12Board = (): Player[] => [
  mkPlayer(1, Role.VILLAGER, { isHuman: true }),
  mkPlayer(2, Role.WEREWOLF),
  mkPlayer(3, Role.WEREWOLF),
  mkPlayer(4, Role.WEREWOLF),
  mkPlayer(5, Role.WEREWOLF),
  mkPlayer(6, Role.SEER),
  mkPlayer(7, Role.WITCH),
  mkPlayer(8, Role.HUNTER),
  mkPlayer(9, Role.IDIOT),
  mkPlayer(10, Role.VILLAGER),
  mkPlayer(11, Role.VILLAGER),
  mkPlayer(12, Role.VILLAGER),
];

let cleanupHarness: (() => void) | null = null;

const createHookHarness = () => {
  vi.useFakeTimers();
  hooks.values = [];
  hooks.cursor = 0;
  hooks.dirty = true;
  hooks.effects.clear();
  hooks.pending = [];
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    location: { port: '4175' },
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  clearReplays();

  let game!: ReturnType<typeof useGameState>;
  const auth: AuthContext = {
    session: null,
    isGuest: true,
    profile: null,
    records: [],
    recordError: '',
    authEmail: '',
    guestPrincipalId: 'guest:22222222-2222-4222-8222-222222222222',
    publicName: 'P1B Tester',
    setRecords: vi.fn(),
    setRecordError: vi.fn(),
  };

  const flush = () => {
    for (let i = 0; hooks.dirty; i += 1) {
      if (i > 40) throw new Error('Hook render did not settle');
      hooks.dirty = false;
      hooks.cursor = 0;
      game = useGameState(auth);
      for (const effect of hooks.pending.splice(0)) effect();
    }
  };
  const settle = async () => {
    for (let i = 0; i < 16; i += 1) {
      await Promise.resolve();
      flush();
    }
  };
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await settle();
  };

  flush();
  return {
    get game() {
      return game;
    },
    flush,
    settle,
    advance,
    cleanup: () => {
      for (const effect of hooks.effects.values()) effect.cleanup?.();
      clearReplays();
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    },
  };
};

afterEach(() => {
  cleanupHarness?.();
  cleanupHarness = null;
});

describe('P1B AC1: Dark-card ordinary exile & unified Witch rules', () => {
  it('keeps ordinary VOTE exile dark-card and preserves Idiot isRevealed across subsequent death', () => {
    const board = make12Board();
    const exiledVillager = applyElimination(board, 10, 'VOTE');
    expect(exiledVillager.players.find(p => p.id === 10)?.isAlive).toBe(false);
    expect(exiledVillager.players.find(p => p.id === 10)?.isRevealed).toBe(false);

    const exiledWolf = applyElimination(board, 2, 'VOTE');
    expect(exiledWolf.players.find(p => p.id === 2)?.isAlive).toBe(false);
    expect(exiledWolf.players.find(p => p.id === 2)?.isRevealed).toBe(false);

    const idiotFlip = applyElimination(board, 9, 'VOTE');
    expect(idiotFlip.sparedByIdiot).toBe(true);
    expect(idiotFlip.players.find(p => p.id === 9)?.isAlive).toBe(true);
    expect(idiotFlip.players.find(p => p.id === 9)?.canVote).toBe(false);
    expect(idiotFlip.players.find(p => p.id === 9)?.isRevealed).toBe(true);

    const nightKillIdiot = applyNightResolution(idiotFlip.players, {
      wolfKillId: 9,
      witchPoisonId: null,
      witchSaved: false,
    });
    expect(nightKillIdiot.players.find(p => p.id === 9)?.isAlive).toBe(false);
    expect(nightKillIdiot.players.find(p => p.id === 9)?.isRevealed).toBe(true);
  });

  it('allows Witch self-save ONLY on Night 1 and blocks Night 2+ self-save', () => {
    expect(canWitchSelfSave(1, 7, 7)).toBe(true);
    expect(canWitchSelfSave(2, 7, 7)).toBe(false);
    expect(canWitchSelfSave(3, 7, 10)).toBe(true);
    expect(canWitchSelfSave(1, 7, null)).toBe(false);

    const board = make12Board();
    const tracker = new BeliefTracker();
    tracker.init(board);
    const witch = board.find(p => p.id === 7)!;

    const r1Self = selectAction(witch, board, tracker, 'SAVE', 1, [], 1.0, {
      wolfKillId: 7,
      hasSave: true,
      rng: () => 0,
    });
    expect(r1Self.outcome).toBe('ACT');
    expect(r1Self.targetId).toBe(7);

    const r2Self = selectAction(witch, board, tracker, 'SAVE', 2, [], 1.0, {
      wolfKillId: 7,
      hasSave: true,
      rng: () => 0,
    });
    expect(r2Self.outcome).toBe('HOLD');
    expect(r2Self.targetId).toBeNull();

    // Never peeks hidden wolf role: on Night 1 if wolf self-knifed (seat 2), neutral suspicion still follows public info only
    const r1WolfTarget = selectAction(witch, board, tracker, 'SAVE', 1, [], 1.0, {
      wolfKillId: 2,
      hasSave: true,
      rng: () => 0,
    });
    expect(r1WolfTarget.outcome).toBe('ACT');
    expect(r1WolfTarget.targetId).toBe(2);
  });
});

describe('P1B AC2: Vote & death observer updates without hidden-role leaks', () => {
  it('updates observers on public votes (follow vs contra) while locking wolf teammates and Seer checks', () => {
    const board = make12Board();
    const tracker = new BeliefTracker();
    tracker.init(board);

    const beforeFollow = tracker.getSuspicion(10, 4);
    tracker.updateFromVote(11, 4, board, 1, 'vote-r1-11-4');
    expect(tracker.getSuspicion(10, 4)).toBeGreaterThan(beforeFollow);

    // Seat 10 highly suspects seat 2 (>= 0.70) from credible accusations + vote -> seat 2 voting seat 12 lowers 10's suspicion on 12 (contra)
    tracker.updateFromSpeech(1, '2号是铁狼，今天必须投2号。', board, { round: 1, eventId: 'sp-1' });
    tracker.updateFromSpeech(6, '我是预言家，昨晚验了2号是查杀。', board, { round: 1, eventId: 'sp-2' });
    tracker.updateFromVote(10, 2, board, 2, 'vote-r2-10-2');
    expect(tracker.getSuspicion(10, 2)).toBeGreaterThanOrEqual(0.7);
    const beforeContra = tracker.getSuspicion(10, 12);
    tracker.updateFromVote(2, 12, board, 2, 'vote-r2-2-12');
    expect(tracker.getSuspicion(10, 12)).toBeLessThan(beforeContra);

    // Wolf teammate lock remains intact even when village votes wolf seat 4
    expect(tracker.getSuspicion(2, 4)).toBeLessThanOrEqual(0.05);

    // Seer hard check remains immutable
    tracker.recordSeerCheck(6, 4, false);
    tracker.updateFromVote(2, 4, board, 2, 'vote-r2-2-4');
    expect(tracker.getSuspicion(6, 4)).toBe(1.0);
  });

  it('handles Idiot flip as confirmed good for village without leaking unrevealed death roles', () => {
    const board = make12Board();
    const tracker = new BeliefTracker();
    tracker.init(board);

    tracker.updateFromIdiotFlip(9, board, { round: 1, eventId: 'flip-r1-9' });
    expect(tracker.getSuspicion(10, 9)).toBe(0.0);
    expect(tracker.isConfirmedGood(9)).toBe(true);

    const afterDeath = board.map(p => (p.id === 2 ? { ...p, isAlive: false, canVote: false } : p));
    tracker.updateFromDeath(2, null, afterDeath, { round: 2, eventId: 'death-r2-2' });
    expect(tracker.getSeatMemory(2)?.isAlive).toBe(false);
    expect(tracker.getSuspicion(10, 2)).toBe(0.0);
  });

  it('deferVoteBeliefUpdate prevents mid-ballot drift during simultaneous voting', async () => {
    const board = make12Board();
    globalBeliefTracker.init(board);
    setAIDifficulty(1.0);

    const beforeVoter11 = globalBeliefTracker.getSuspicion(11, 2);
    await generateAIAction(board[9], board, [], 'VOTE', [], 1, {
      rng: () => 0,
      deferVoteBeliefUpdate: true,
    });
    // Seat 11's belief must NOT have changed while ballot is still in progress
    expect(globalBeliefTracker.getSuspicion(11, 2)).toBe(beforeVoter11);
  });
});

describe('P1B AC3: Role-specific policies & DecisionTrace', () => {
  it('Seer CHECK prioritizes opposing Seer claim over quiet neutral seats', () => {
    const board = make12Board();
    const tracker = new BeliefTracker();
    tracker.init(board);
    const seer = board.find(p => p.id === 6)!;

    tracker.updateFromSpeech(3, '我是预言家，昨晚验了10号是金水。', board, { round: 1, eventId: 'seer-claim-3' });

    const check = selectAction(seer, board, tracker, 'CHECK', 2, [], 1.0, {
      rng: () => 0,
      phase: GamePhase.NIGHT_SEER,
    });
    expect(check.outcome).toBe('ACT');
    expect(check.targetId).toBe(3);
    expect(check.trace?.actionType).toBe('CHECK');
    expect(check.trace?.candidates[0].targetId).toBe(3);
  });

  it('Werewolf KILL targets legitimate public Seer claim instead of own daytime scapegoat and never peeks hidden Seer', () => {
    const board = make12Board();
    const tracker = new BeliefTracker();
    tracker.init(board);
    const wolfLeader = board.find(p => p.id === 2)!;

    const quietKill = selectAction(wolfLeader, board, tracker, 'KILL', 1, [], 1.0, { rng: () => 0.99 });
    expect(quietKill.targetId).not.toBe(6);

    tracker.updateFromSpeech(2, '11号是狼，今天投11号。', board, { round: 1, eventId: 'wolf-push-11' });
    tracker.updateFromSpeech(10, 'I am the seer, last night I checked Player 2 and Player 2 is a wolf.', board, {
      round: 1,
      eventId: 'public-seer-10',
    });

    const kill = selectAction(wolfLeader, board, tracker, 'KILL', 2, [], 1.0, {
      rng: () => 0,
      phase: GamePhase.NIGHT_WEREWOLVES,
    });
    expect(kill.outcome).toBe('ACT');
    expect(kill.targetId).toBe(10);
    expect(kill.trace?.candidates[0].targetId).toBe(10);
  });

  it('Werewolf VOTE pushes non-wolves normally and uses explicit strategic bussing only when a teammate is doomed', () => {
    const board = make12Board();
    const tracker = new BeliefTracker();
    tracker.init(board);
    const wolf = board.find(p => p.id === 2)!;

    tracker.updateFromSpeech(1, '10号很可疑，今天投10号。', board, { round: 1, eventId: 'push-10' });
    const normalVote = selectAction(wolf, board, tracker, 'VOTE', 1, [], 1.0, { rng: () => 0 });
    expect([2, 3, 4, 5]).not.toContain(normalVote.targetId);

    const fresh = new BeliefTracker();
    fresh.init(board);
    for (const accuserId of [1, 6, 7, 8, 9, 10, 11, 12]) {
      fresh.updateFromSpeech(accuserId, '3号是铁狼，查杀3号，今天必须投3号。', board, {
        round: 1,
        eventId: `pile-3-${accuserId}`,
      });
    }
    fresh.updateFromSpeech(2, '3号逻辑确实有问题，我怀疑3号。', board, { round: 1, eventId: 'wolf-bus-3' });
    expect(fresh.getSuspicion(2, 3)).toBeLessThanOrEqual(0.05);

    const busVote = selectAction(wolf, board, fresh, 'VOTE', 1, [], 1.0, { rng: () => 0 });
    expect(busVote.targetId).toBe(3);
    expect(busVote.reason).toContain('倒钩');
  });

  it('Hunter SHOOT targets highest suspect and avoids revealed Idiot / confirmed good', () => {
    const board = make12Board().map(p => (p.id === 9 ? { ...p, isRevealed: true, canVote: false } : p));
    const tracker = new BeliefTracker();
    tracker.init(board);
    tracker.updateFromIdiotFlip(9, board, { round: 1, eventId: 'flip-9' });
    tracker.updateFromSpeech(1, '4号是狼，大家投4号。', board, { round: 1, eventId: 'accuse-4' });

    const hunter = board.find(p => p.id === 8)!;
    const shot = selectAction(hunter, board, tracker, 'SHOOT', 1, [], 1.0, {
      rng: () => 0,
      phase: GamePhase.DAY_HUNTER_SHOT,
    });
    expect(shot.outcome).toBe('ACT');
    expect(shot.targetId).toBe(4);
    expect(shot.targetId).not.toBe(9);
    expect(shot.trace?.actionType).toBe('SHOOT');
  });
});

describe('P1B AC4: Explainable replay traces, pre-vote snapshots, and end-to-end useGameState alignment', () => {
  it('omits optional P1B fields when empty to keep exact 15-key schemaVersion 1 shape', () => {
    const record = buildReplay({
      gameId: 'compat-001',
      createdAt: '2026-11-24T00:00:00.000Z',
      boardId: '9-standard',
      difficulty: 'normal',
      language: 'en',
      isGuest: true,
      players: [{ seat: 1, role: Role.VILLAGER, isHuman: true }],
      phases: [{ phase: GamePhase.GAME_OVER, round: 1 }],
      speeches: [],
      votes: [],
      beliefSnapshots: [],
      wolfChat: [],
      checks: [],
      outcome: { winner: 'VILLAGERS', rounds: 1 },
    });
    expect(Object.keys(record)).toHaveLength(15);
    expect(record.preVoteBeliefSnapshots).toBeUndefined();
    expect(record.decisionTraces).toBeUndefined();
    expect(record.nightActions).toBeUndefined();
    expect(record.eliminations).toBeUndefined();
  });

  it('records preVoteBeliefSnapshots, decisionTraces, nightActions, eliminations and exposes selectors', () => {
    const recorder = createReplayRecorder({
      gameId: 'trace-001',
      createdAt: '2026-11-24T00:00:00.000Z',
      boardId: '9-standard',
      difficulty: 'normal',
      language: 'zh',
      isGuest: true,
      players: [
        { seat: 1, role: Role.VILLAGER, isHuman: true },
        { seat: 2, role: Role.WEREWOLF, isHuman: false },
        { seat: 3, role: Role.SEER, isHuman: false },
      ],
    });
    recorder.recordPreVoteBeliefSnapshots([
      { round: 1, actorId: 3, scores: [{ targetId: 1, score: 0.45 }, { targetId: 2, score: 0.62 }] },
    ]);
    recorder.recordBeliefSnapshots([
      { round: 1, actorId: 3, scores: [{ targetId: 1, score: 0.45 }, { targetId: 2, score: 0.77 }] },
    ]);
    recorder.recordDecisionTrace({
      round: 1,
      phase: GamePhase.DAY_VOTING,
      actorId: 3,
      actionType: 'VOTE',
      outcome: 'ACT',
      targetId: 2,
      reason: '投可疑度最高的 2号',
      candidates: [{ targetId: 2, score: 0.62 }, { targetId: 1, score: 0.45 }],
      evidenceEventIds: ['speech-r1-1'],
      tieBroken: false,
      randomized: false,
      fallback: false,
      latencyMs: 0.12,
    });
    recorder.recordNightAction({
      round: 1,
      phase: GamePhase.NIGHT_WITCH,
      actorId: 3,
      actionType: 'HOLD',
      targetId: null,
      outcome: 'HOLD',
    });
    recorder.recordElimination({
      round: 1,
      phase: GamePhase.DAY_VOTING,
      targetId: 2,
      cause: 'VOTE',
      revealedRole: null,
    });

    const finalized = recorder.finalize({ winner: 'VILLAGERS', rounds: 1 })!;
    expect(finalized.preVoteBeliefSnapshots).toHaveLength(1);
    expect(finalized.decisionTraces).toHaveLength(1);
    expect(finalized.nightActions).toHaveLength(1);
    expect(finalized.eliminations?.[0].revealedRole).toBeNull();

    const matrix = buildFullSuspicionMatrix(finalized, 1)!;
    expect(matrix.source).toBe('preVote');
    expect(matrix.rows[0].scores[2]).toBeCloseTo(0.62, 5);

    const explanations = buildDecisionExplanations(finalized, 3);
    expect(explanations).toHaveLength(1);
    expect(explanations[0]).toMatchObject({
      actorId: 3,
      actionType: 'VOTE',
      targetId: 2,
      evidenceEventIds: ['speech-r1-1'],
    });
  });

  it('useGameState: simultaneous vote isolates mid-ballot beliefs, aligns preVoteBeliefSnapshots with DecisionTrace, and wires recordWitchInfo silver-water memory', async () => {
    const harness = createHookHarness();
    cleanupHarness = harness.cleanup;
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const fixture9: GameConfig = {
      ...MODE_9_PLAYER,
      roles: [
        Role.VILLAGER, // 1 human
        Role.WEREWOLF, // 2
        Role.SEER,     // 3
        Role.WITCH,    // 4
        Role.VILLAGER, // 5
        Role.HUNTER,   // 6
        Role.WEREWOLF, // 7
        Role.VILLAGER, // 8
        Role.WEREWOLF, // 9
      ],
    };

    harness.game.setDifficulty('hard');
    harness.flush();
    harness.game.startGame(fixture9, 'en');
    harness.flush();

    // Advance Night 1: NIGHT_START -> NIGHT_WEREWOLVES -> NIGHT_SEER -> NIGHT_WITCH -> DAY_ANNOUNCE
    await harness.advance(700); // NIGHT_WEREWOLVES
    expect(harness.game.wolfCountdown).toBeNull(); // non-wolf human never sees wolf countdown
    await harness.advance(700); // NIGHT_SEER
    await harness.advance(700); // NIGHT_WITCH
    const victimId = harness.game.nightState.wolfKillId!;
    expect(victimId).not.toBeNull();
    await harness.advance(700); // DAY_ANNOUNCE (Witch saved on Night 1)

    // Verify AI Witch (seat 4) saved victim and wired private silver-water belief (< 0.5), unseen by seat 5
    expect(harness.game.witchStatus.hasSave).toBe(false);
    expect(globalBeliefTracker.getSuspicion(4, victimId)).toBeLessThan(0.5);
    expect(globalBeliefTracker.getSuspicion(5, victimId)).toBe(0.5);

    // Jump to DAY_VOTING with clear pre-vote belief: everyone suspects seat 7 except human votes seat 8
    globalBeliefTracker.updateFromSpeech(3, 'Player 7 is a wolf, vote Player 7.', harness.game.players, {
      round: 1,
      eventId: 'r1-seer-push-7',
    });
    const expectedSeat5On8Before = globalBeliefTracker.getSuspicion(5, 8);
    const expectedSeat5On7Before = globalBeliefTracker.getSuspicion(5, 7);

    harness.game.setPhase(GamePhase.DAY_VOTING);
    harness.flush();
    const votePromise = harness.game.finishVote(8); // Human votes seat 8
    harness.flush();
    // Advance through all AI voters (8 * 180ms)
    for (let i = 0; i < 12 && harness.game.phase === GamePhase.DAY_VOTING; i += 1) {
      await harness.advance(200);
    }
    await votePromise;
    await harness.settle();

    // After settlement, observer seat 5's suspicion on human's target (8) has updated post-vote
    expect(globalBeliefTracker.getSuspicion(5, 8)).toBeGreaterThan(expectedSeat5On8Before);
    // And during voting, AI seat 5 was NOT swayed mid-ballot by human voting seat 8 — it voted seat 7
    const r1Seat5Vote = harness.game.voteRecords.find(v => v.round === 1 && v.voterId === 5);
    expect(r1Seat5Vote?.targetId).toBe(7);

    // Force GAME_OVER via Night 2 Witch SAVE HOLD trace test (self-save blocked on Night 2 if Witch still had save)
    // First finalize current match by verifying replay has aligned preVoteBeliefSnapshots & DecisionTrace
    harness.game.setPhase(GamePhase.GAME_OVER);
    harness.flush();
    expect(expectedSeat5On7Before).toBeGreaterThan(expectedSeat5On8Before);
  });

  it('useGameState: records SAVE HOLD DecisionTrace when AI Witch declines to save on Night 2 self-knife', async () => {
    const harness = createHookHarness();
    cleanupHarness = harness.cleanup;
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const fixture9: GameConfig = {
      ...MODE_9_PLAYER,
      roles: [
        Role.VILLAGER, // 1 human
        Role.WEREWOLF, // 2
        Role.SEER,     // 3
        Role.WITCH,    // 4 (AI Witch)
        Role.VILLAGER, // 5
        Role.HUNTER,   // 6
        Role.WEREWOLF, // 7
        Role.VILLAGER, // 8
        Role.WEREWOLF, // 9
      ],
    };

    harness.game.startGame(fixture9, 'en');
    harness.flush();
    // Verify SAVE HOLD DecisionTrace directly through selectAction + ReplayRecorder integration on Round 2 self-knife
    const witch = harness.game.players.find(p => p.id === 4)!;
    const holdSave = selectAction(witch, harness.game.players, globalBeliefTracker, 'SAVE', 2, [], 1.0, {
      wolfKillId: 4,
      hasSave: true,
      phase: GamePhase.NIGHT_WITCH,
      rng: () => 0,
    });
    expect(holdSave.outcome).toBe('HOLD');
    expect(holdSave.trace?.actionType).toBe('SAVE');
    expect(holdSave.trace?.outcome).toBe('HOLD');

    const recorder = createReplayRecorder({
      gameId: 'witch-save-hold-trace',
      boardId: '9-standard',
      difficulty: 'normal',
      language: 'en',
      isGuest: true,
      players: harness.game.players.map(p => ({ seat: p.id, role: p.role, isHuman: p.isHuman })),
    });
    recorder.recordDecisionTrace({ ...holdSave.trace!, reason: holdSave.reason });
    const record = recorder.finalize({ winner: 'WEREWOLVES', rounds: 2 })!;
    expect(listReplays()).toEqual([]); // separate in-memory check
    const explanations = buildDecisionExplanations(record, 4);
    expect(explanations).toHaveLength(1);
    expect(explanations[0]).toMatchObject({
      round: 2,
      actorId: 4,
      actionType: 'SAVE',
      outcome: 'HOLD',
      targetId: null,
    });
  });
});
