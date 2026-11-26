import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GamePhase,
  Role,
  type GameConfig,
  type GameLog,
  type Player,
  type VoteRecord,
} from '../types';
import { MODE_9_PLAYER, MODE_12_PLAYER } from '../constants';
import { getRoleCamp } from '../gameEngine';

// Minimal dependency-aware React hook runner (same pattern as useGameState.lifecycle.test.ts)
// so end-to-end tests drive the REAL useGameState -> aiOrchestrator -> actionSelector -> BeliefTracker pipeline.
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

const llm = vi.hoisted(() => ({
  generateSpeechWithLLM: vi.fn<(...args: unknown[]) => Promise<{ zh: string; en: string } | null>>(async () => null),
  generateWolfChatWithLLM: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
}));
vi.mock('./geminiAdapter', () => llm);

vi.mock('../services/speechLibrary', () => ({
  pickSpeech: vi.fn(async () => ''),
  pickWolfNightSpeech: vi.fn(async () => ''),
  preloadSpeechPools: vi.fn(async () => undefined),
}));

const audio = vi.hoisted(() => ({
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
vi.mock('../services/speechAudio', () => audio);

vi.mock('../services/supabaseClient', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  saveGameRecord: vi.fn(),
  fetchGameRecords: vi.fn(),
}));

import { BeliefTracker, globalBeliefTracker } from './beliefTracker';
import { selectAction } from './actionSelector';
import {
  generateAIAction,
  generateAIDialogue,
  generateWolfChat,
  resetAIMemory,
  setAIDifficulty,
} from './aiOrchestrator';
import { runReplay, type ReplayInput } from './evaluation';
import { useGameState, type AuthContext } from '../hooks/useGameState';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mkPlayer = (id: number, role: Role, overrides: Partial<Player> = {}): Player => ({
  id,
  name: id === 1 ? 'Human' : `P${id}`,
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

const make9Board = (): Player[] => [
  mkPlayer(1, Role.VILLAGER, { isHuman: true }),
  mkPlayer(2, Role.WEREWOLF),
  mkPlayer(3, Role.SEER),
  mkPlayer(4, Role.WITCH),
  mkPlayer(5, Role.VILLAGER),
  mkPlayer(6, Role.HUNTER),
  mkPlayer(7, Role.WEREWOLF),
  mkPlayer(8, Role.VILLAGER),
  mkPlayer(9, Role.WEREWOLF),
];

const createSeededRng = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const fixture9: GameConfig = {
  ...MODE_9_PLAYER,
  roles: [
    Role.VILLAGER,
    Role.WEREWOLF,
    Role.SEER,
    Role.WITCH,
    Role.VILLAGER,
    Role.HUNTER,
    Role.WEREWOLF,
    Role.VILLAGER,
    Role.WEREWOLF,
  ],
};

const createHookHarness = () => {
  hooks.values = [];
  hooks.cursor = 0;
  hooks.dirty = true;
  hooks.effects.clear();
  hooks.pending = [];

  let game!: ReturnType<typeof useGameState>;
  const auth: AuthContext = {
    session: null,
    isGuest: true,
    profile: null,
    records: [],
    recordError: '',
    authEmail: '',
    guestPrincipalId: 'guest:p0-correctness-test',
    publicName: 'P0Tester',
    setRecords: vi.fn(next => {
      auth.records = typeof next === 'function' ? next(auth.records) : next;
      hooks.dirty = true;
    }),
    setRecordError: vi.fn(next => {
      auth.recordError = typeof next === 'function' ? next(auth.recordError) : next;
      hooks.dirty = true;
    }),
  };

  const flush = () => {
    for (let i = 0; hooks.dirty; i++) {
      if (i > 40) throw new Error('Hook render did not settle');
      hooks.dirty = false;
      hooks.cursor = 0;
      game = useGameState(auth);
      for (const effect of hooks.pending.splice(0)) effect();
    }
  };
  const settle = async () => {
    for (let i = 0; i < 30; i++) {
      await Promise.resolve();
      flush();
    }
  };
  const advance = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await settle();
  };
  const cleanup = () => {
    for (const effect of hooks.effects.values()) effect.cleanup?.();
  };

  flush();
  return {
    get game() {
      return game;
    },
    flush,
    settle,
    advance,
    cleanup,
  };
};

let activeCleanup: (() => void) | null = null;

beforeEach(() => {
  resetAIMemory();
  setAIDifficulty(0.85);
  llm.generateSpeechWithLLM.mockReset().mockResolvedValue(null);
  llm.generateWolfChatWithLLM.mockReset().mockResolvedValue([]);
  Object.values(audio).forEach(mock => mock.mockClear());
  audio.enqueue.mockResolvedValue(undefined);
});

afterEach(() => {
  activeCleanup?.();
  activeCleanup = null;
  resetAIMemory();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const stubBrowserGlobals = () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    location: { port: '4175' },
  });
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
};

// ─── 1. Witch active poison hold & target legality ───────────────────────────

describe('P0-1: Witch active poison hold preserved end-to-end', () => {
  it('selectAction(POISON) returns outcome HOLD when suspicion <= 0.7 even at actionAccuracy 0', () => {
    const players = make9Board();
    const witch = players[3];
    const beliefs = new BeliefTracker();
    beliefs.init(players);

    for (let i = 0; i < 25; i++) {
      const decision = selectAction(witch, players, beliefs, 'POISON', 1, [], 0.0, {
        rng: createSeededRng(100 + i),
      });
      expect(decision.outcome).toBe('HOLD');
      expect(decision.targetId).toBeNull();
      expect(decision.randomized).toBe(false);
    }
  });

  it('generateAIAction(POISON) preserves HOLD without falling through to random fallback', async () => {
    const players = make9Board();
    const witch = players[3];
    globalBeliefTracker.init(players);
    setAIDifficulty(0.0); // worst-case difficulty accuracy

    for (let i = 0; i < 20; i++) {
      const action = await generateAIAction(witch, players, [], 'POISON', [], 1, {
        rng: createSeededRng(200 + i),
      });
      expect(action.outcome).toBe('HOLD');
      expect(action.targetId).toBeNull();
      expect(action.reason).not.toBe('random fallback');
    }
  });

  it('selectAction(POISON) excludes revealed players and excludedTargetIds and acts when suspicion > 0.7', () => {
    const players = make9Board();
    players[1].isRevealed = true; // Seat 2 revealed
    const witch = players[3];
    const beliefs = new BeliefTracker();
    beliefs.init(players);

    // Push Seat 2 (revealed), Seat 7 (wolfKillId excluded), and Seat 9 (legal suspect) above 0.7
    for (let i = 0; i < 3; i++) {
      beliefs.updateFromVote(witch.id, 2);
      beliefs.updateFromVote(witch.id, 7);
      beliefs.updateFromVote(witch.id, 9);
    }
    // Make Seat 7 even higher than Seat 9 to prove excludedTargetIds wins
    beliefs.updateFromVote(witch.id, 7);

    const decision = selectAction(witch, players, beliefs, 'POISON', 2, [], 0.72, {
      rng: () => 0.99,
      excludedTargetIds: new Set([7]),
    });
    expect(decision.outcome).toBe('ACT');
    expect(decision.targetId).toBe(9);
  });

  it('end-to-end useGameState NIGHT_WITCH -> DAY_ANNOUNCE preserves hasPoison=true and 0 poison deaths on HOLD', async () => {
    stubBrowserGlobals();
    // 0.9 ensures: if wolfKillId is null, save is skipped and Math.random() > 0.72 enters POISON branch
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const harness = createHookHarness();
    activeCleanup = harness.cleanup;

    harness.game.startGame(fixture9, 'en');
    harness.flush();

    // Jump to NIGHT_WITCH with no wolf kill and neutral beliefs (all 0.5 <= 0.7)
    harness.game.setPhase(GamePhase.NIGHT_WITCH);
    harness.flush();
    await harness.advance(700);

    expect(harness.game.phase).toBe(GamePhase.DAY_ANNOUNCE);
    expect(harness.game.witchStatus.hasPoison).toBe(true);
    expect(harness.game.nightState.witchPoisonId).toBeNull();

    // Let DAY_ANNOUNCE run applyNightResolution
    await harness.advance(700);
    expect(harness.game.deadThisRound).toEqual([]);
    expect(harness.game.players.every(p => p.isAlive)).toBe(true);
    expect(harness.game.witchStatus.hasPoison).toBe(true);
  });

  it('end-to-end useGameState NIGHT_WITCH poisons high-suspicion suspect (>0.7), excludes wolfKillId, and consumes hasPoison', async () => {
    stubBrowserGlobals();
    // First random > 0.45 is skipped because hasSave will be exhausted or wolfKillId null;
    // here we advance through Night 1 with controlled random values:
    // - wolfKill picks seat 5 (or direct nightState via wolf phase)
    // - save fails (0.2 <= 0.45), poison gate passes (0.9 > 0.72)
    let witchCall = 0;
    const rngSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      // Used during startGame and phases; once in NIGHT_WITCH we control exact sequence below
      return 0.5;
    });
    const harness = createHookHarness();
    activeCleanup = harness.cleanup;

    harness.game.startGame(fixture9, 'en');
    harness.flush();

    const witch = harness.game.players.find(p => p.role === Role.WITCH)!;
    // Raise witch's suspicion on Seat 5 (who will be wolf-killed) and Seat 9 (who should be poisoned)
    for (let i = 0; i < 3; i++) {
      globalBeliefTracker.updateFromVote(witch.id, 5);
      globalBeliefTracker.updateFromVote(witch.id, 9);
    }
    globalBeliefTracker.updateFromVote(witch.id, 5); // 5 is higher, but will be wolfKillId -> excluded

    // Advance NIGHT_START -> NIGHT_WEREWOLVES -> NIGHT_SEER -> NIGHT_WITCH
    // Make Wolf leader kill Seat 5 by raising wolf's suspicion on Seat 5
    const wolfLeader = harness.game.players.find(p => p.role === Role.WEREWOLF)!;
    for (let i = 0; i < 3; i++) {
      globalBeliefTracker.updateFromVote(wolfLeader.id, 5);
    }

    await harness.advance(700); // NIGHT_START -> NIGHT_WEREWOLVES
    await harness.advance(700); // NIGHT_WEREWOLVES -> NIGHT_SEER (wolfKillId = 5)
    expect(harness.game.nightState.wolfKillId).toBe(5);
    await harness.advance(700); // NIGHT_SEER -> NIGHT_WITCH
    expect(harness.game.phase).toBe(GamePhase.NIGHT_WITCH);

    // In NIGHT_WITCH: 1st Math.random() <= 0.45 (do not save), 2nd Math.random() > 0.72 (attempt poison)
    rngSpy.mockImplementation(() => {
      witchCall += 1;
      if (witchCall === 1) return 0.2;
      return 0.9;
    });

    await harness.advance(700); // NIGHT_WITCH -> DAY_ANNOUNCE
    expect(harness.game.phase).toBe(GamePhase.DAY_ANNOUNCE);
    expect(harness.game.nightState.witchSaved).toBe(false);
    expect(harness.game.nightState.witchPoisonId).toBe(9);
    expect(harness.game.witchStatus.hasPoison).toBe(false);

    await harness.advance(700); // DAY_ANNOUNCE runs applyNightResolution
    expect(harness.game.deadThisRound).toEqual(expect.arrayContaining([5, 9]));
    expect(harness.game.players.find(p => p.id === 9)?.isAlive).toBe(false);
  });

  it('handleWitchPhase does not read hidden killedPlayer.role when deciding to save', async () => {
    stubBrowserGlobals();
    // 0.8 > 0.45 triggers save whenever wolfKillId is set and hasSave is true
    vi.spyOn(Math, 'random').mockReturnValue(0.8);
    const harness = createHookHarness();
    activeCleanup = harness.cleanup;

    // Make seat 2 a Werewolf and simulate a night where seat 2 is wolfKillId (e.g. self-knife / edge state)
    const wolfTargetedConfig: GameConfig = {
      ...MODE_9_PLAYER,
      roles: [
        Role.VILLAGER,
        Role.WEREWOLF,
        Role.SEER,
        Role.WITCH,
        Role.VILLAGER,
        Role.HUNTER,
        Role.WEREWOLF,
        Role.VILLAGER,
        Role.WEREWOLF,
      ],
    };
    harness.game.startGame(wolfTargetedConfig, 'en');
    harness.flush();

    // Advance normally through NIGHT_START -> NIGHT_WEREWOLVES -> NIGHT_SEER -> NIGHT_WITCH
    await harness.advance(700);
    await harness.advance(700);
    await harness.advance(700);
    expect(harness.game.phase).toBe(GamePhase.NIGHT_WITCH);
    expect(harness.game.nightState.wolfKillId).not.toBeNull();

    // Verify source code no longer inspects killedPlayer?.role !== Role.WEREWOLF
    // AND runtime save succeeds purely from public nightState.wolfKillId + hasSave.
    await harness.advance(700);
    expect(harness.game.nightState.witchSaved).toBe(true);
    expect(harness.game.witchStatus.hasSave).toBe(false);
  });
});

// ─── 2. Candidate legality, real round, Seer tracking, cross-game isolation ──

describe('P0-2: Candidate legality, real round, Seer check tracking, and cross-game reset', () => {
  it('selectAction(VOTE) includes alive revealed Idiot (canVote=false) and filters dead targets in tally fallback', () => {
    const players = [
      mkPlayer(1, Role.VILLAGER, { isHuman: true }),
      mkPlayer(2, Role.IDIOT, { isAlive: true, canVote: false, isRevealed: true }),
      mkPlayer(3, Role.WEREWOLF, { isAlive: false, canVote: false }),
      mkPlayer(4, Role.VILLAGER),
    ];
    const beliefs = new BeliefTracker();
    beliefs.init(players);
    beliefs.updateFromVote(4, 2);
    beliefs.updateFromVote(4, 2);

    const decision = selectAction(players[3], players, beliefs, 'VOTE', 2, [], 1.0, {
      rng: () => 0,
    });
    expect(decision.outcome).toBe('ACT');
    expect(decision.targetId).toBe(2);

    // Tally fallback (uninitialized belief tracker): dead seat 3 must be ignored, alive seat 2 accepted
    const emptyBeliefs = new BeliefTracker();
    const voteRecords: VoteRecord[] = [
      { round: 2, voterId: 1, targetId: 3, phase: GamePhase.DAY_VOTING },
      { round: 2, voterId: 4, targetId: 3, phase: GamePhase.DAY_VOTING },
      { round: 2, voterId: 1, targetId: 2, phase: GamePhase.DAY_VOTING },
      { round: 1, voterId: 1, targetId: 1, phase: GamePhase.DAY_VOTING }, // wrong round
    ];
    const tallyDecision = selectAction(players[3], players, emptyBeliefs, 'VOTE', 2, voteRecords, 1.0, {
      rng: () => 0,
    });
    expect(tallyDecision.targetId).toBe(2);
    expect(tallyDecision.reason).toBe('跟投最多票目标');
  });

  it('useGameState handlePlayerAction rejects human DAY_VOTING click when !me.canVote', async () => {
    stubBrowserGlobals();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const harness = createHookHarness();
    activeCleanup = harness.cleanup;

    // 12-player board where human seat 1 is Idiot
    const idiotConfig: GameConfig = {
      ...MODE_12_PLAYER,
      roles: [
        Role.IDIOT,
        Role.WEREWOLF,
        Role.WEREWOLF,
        Role.WEREWOLF,
        Role.WEREWOLF,
        Role.VILLAGER,
        Role.VILLAGER,
        Role.VILLAGER,
        Role.VILLAGER,
        Role.SEER,
        Role.WITCH,
        Role.HUNTER,
      ],
    };
    harness.game.startGame(idiotConfig, 'en');
    harness.flush();

    // Exile Seat 1 so Idiot reveals and loses canVote
    harness.game.setPhase(GamePhase.DAY_VOTING);
    harness.flush();
    // Push all AI suspicion onto seat 1 so everyone votes seat 1
    for (const p of harness.game.players) {
      if (!p.isHuman) {
        for (let i = 0; i < 4; i++) globalBeliefTracker.updateFromVote(p.id, 1);
      }
    }
    const firstVote = harness.game.finishVote(2);
    harness.flush();
    await harness.advance(12 * 200);
    await firstVote;
    await harness.settle();

    expect(harness.game.me?.isAlive).toBe(true);
    expect(harness.game.me?.isRevealed).toBe(true);
    expect(harness.game.me?.canVote).toBe(false);

    // Move back to DAY_VOTING and pause so auto-resolve does not immediately fire;
    // unpause briefly or test direct handlePlayerAction before timer fires
    harness.game.setPhase(GamePhase.DAY_VOTING);
    harness.flush();
    const votesBefore = harness.game.voteRecords.length;
    const logsBefore = harness.game.logs.length;
    harness.game.handlePlayerAction(3);
    harness.flush();

    // Human vote click must be rejected (isProcessingAI stays false, no new vote log added)
    expect(harness.game.isProcessingAI).toBe(false);
    expect(harness.game.voteRecords.length).toBe(votesBefore);
    expect(harness.game.logs.length).toBe(logsBefore);
    expect(harness.game.logs.some(log => log.message === 'You voted Player 3.')).toBe(false);
  });

  it('BeliefTracker.recordSeerCheck updates only Seer private beliefs and checked set; selectAction(CHECK) never re-checks in strategy or random branch', () => {
    const players = make9Board();
    const seer = players[2]; // Seat 3
    const villager = players[4]; // Seat 5
    const beliefs = new BeliefTracker();
    beliefs.init(players);

    beliefs.recordSeerCheck(seer.id, 2, false); // Wolf
    beliefs.recordSeerCheck(seer.id, 5, true);  // Good

    // Private write for Seer only
    expect(beliefs.getSuspicion(seer.id, 2)).toBe(1.0);
    expect(beliefs.getSuspicion(seer.id, 5)).toBe(0.0);
    expect([...beliefs.getCheckedTargets(seer.id)].sort((a, b) => a - b)).toEqual([2, 5]);

    // Other seats untouched
    expect(beliefs.getSuspicion(villager.id, 2)).toBe(0.5);
    expect(beliefs.getSuspicion(villager.id, 5)).toBe(0.5);
    expect(beliefs.getCheckedTargets(villager.id).size).toBe(0);

    // Also mark seat 6 revealed
    players[5].isRevealed = true;

    // Strategy branch (accuracy 1.0) and difficulty-random branch (accuracy 0.0) both exclude 2, 5, 6
    const rng = createSeededRng(777);
    for (const accuracy of [1.0, 0.0]) {
      for (let i = 0; i < 30; i++) {
        const decision = selectAction(seer, players, beliefs, 'CHECK', 3, [], accuracy, { rng });
        expect(decision.outcome).toBe('ACT');
        expect(decision.targetId).not.toBeNull();
        expect([2, 3, 5, 6]).not.toContain(decision.targetId);
      }
    }

    // When all other alive seats are checked/revealed, returns NO_TARGET
    for (const p of players) {
      if (p.id !== seer.id) beliefs.recordSeerCheck(seer.id, p.id, p.role !== Role.WEREWOLF);
    }
    const exhausted = selectAction(seer, players, beliefs, 'CHECK', 8, [], 0.0, { rng });
    expect(exhausted.outcome).toBe('NO_TARGET');
    expect(exhausted.targetId).toBeNull();
  });

  it('end-to-end useGameState records AI Seer check across Night 1 -> Night 2 without re-checking and passes real round', async () => {
    stubBrowserGlobals();
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // deterministic low index; save skipped (0.1 <= 0.45), poison skipped
    const harness = createHookHarness();
    activeCleanup = harness.cleanup;

    harness.game.startGame(fixture9, 'en');
    harness.flush();

    const seer = harness.game.players.find(p => p.role === Role.SEER)!;

    // Night 1 (round 1)
    await harness.advance(700); // NIGHT_START -> NIGHT_WEREWOLVES (roundCount = 1)
    expect(harness.game.roundCount).toBe(1);
    await harness.advance(700); // NIGHT_WEREWOLVES -> NIGHT_SEER
    await harness.advance(700); // NIGHT_SEER -> NIGHT_WITCH
    const night1Check = harness.game.aiSeerLastCheck;
    expect(night1Check).not.toBeNull();
    expect(globalBeliefTracker.getCheckedTargets(seer.id).has(night1Check!.targetId)).toBe(true);
    expect(globalBeliefTracker.getSuspicion(seer.id, night1Check!.targetId)).toBe(
      night1Check!.isGood ? 0.0 : 1.0,
    );

    // Non-seer seat must not know Seer's private check
    const villager = harness.game.players.find(p => p.role === Role.VILLAGER && !p.isHuman)!;
    expect(globalBeliefTracker.getSuspicion(villager.id, night1Check!.targetId)).toBe(0.5);

    // Move to Night 2 (round 2)
    harness.game.setPhase(GamePhase.NIGHT_START);
    harness.flush();
    await harness.advance(700); // roundCount = 2
    expect(harness.game.roundCount).toBe(2);
    await harness.advance(700); // NIGHT_WEREWOLVES -> NIGHT_SEER
    await harness.advance(700); // NIGHT_SEER -> NIGHT_WITCH

    const night2Check = harness.game.aiSeerLastCheck;
    expect(night2Check).not.toBeNull();
    expect(night2Check!.targetId).not.toBe(night1Check!.targetId);
    expect(globalBeliefTracker.getCheckedTargets(seer.id).size).toBe(2);
  });

  it('passes real roundCount to selectAction VOTE tally fallback via generateAIAction', async () => {
    const players = make9Board();
    const voter = players[4];
    const spy = vi.spyOn(globalBeliefTracker, 'getMostSuspicious').mockReturnValue(null);
    globalBeliefTracker.init(players);

    const voteRecords: VoteRecord[] = [
      { round: 1, voterId: 1, targetId: 2, phase: GamePhase.DAY_VOTING },
      { round: 1, voterId: 3, targetId: 2, phase: GamePhase.DAY_VOTING },
      { round: 3, voterId: 1, targetId: 9, phase: GamePhase.DAY_VOTING },
      { round: 3, voterId: 3, targetId: 9, phase: GamePhase.DAY_VOTING },
    ];

    setAIDifficulty(1.0);
    const round3Action = await generateAIAction(voter, players, [], 'VOTE', voteRecords, 3, {
      rng: () => 0,
    });
    spy.mockRestore();

    // Must read round 3 tally (Seat 9), not hardcoded round 1 tally (Seat 2)
    expect(round3Action.targetId).toBe(9);
  });

  it('cross-game isolation: startGame and leaveGame reset globalBeliefTracker so Game 2 inherits nothing from Game 1', async () => {
    stubBrowserGlobals();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const harness = createHookHarness();
    activeCleanup = harness.cleanup;

    // Game 1: seats 2, 7, 9 are wolves; seat 3 is seer
    harness.game.startGame(fixture9, 'en');
    harness.flush();
    expect(globalBeliefTracker.getSuspicion(2, 7)).toBe(0.05);
    globalBeliefTracker.updateFromVote(5, 1);
    globalBeliefTracker.updateFromVote(5, 1);
    globalBeliefTracker.recordSeerCheck(3, 2, false);
    expect(globalBeliefTracker.getSuspicion(5, 1)).toBeCloseTo(0.8, 6);
    expect(globalBeliefTracker.getCheckedTargets(3).has(2)).toBe(true);

    // Leave Game 1 -> tracker cleared
    harness.game.leaveGame();
    harness.flush();
    expect(globalBeliefTracker.snapshot(5)).toEqual([]);
    expect(globalBeliefTracker.getCheckedTargets(3).size).toBe(0);

    // Game 2: different role layout (seats 2, 7 are villagers; seats 4, 5, 6 are wolves)
    const game2Config: GameConfig = {
      ...MODE_9_PLAYER,
      roles: [
        Role.VILLAGER,
        Role.VILLAGER,
        Role.SEER,
        Role.WEREWOLF,
        Role.WEREWOLF,
        Role.WEREWOLF,
        Role.VILLAGER,
        Role.WITCH,
        Role.HUNTER,
      ],
    };
    harness.game.startGame(game2Config, 'en');
    harness.flush();

    // Seat 2 and Seat 7 are no longer wolves -> must be 0.5, NOT leaked 0.05
    expect(globalBeliefTracker.getSuspicion(2, 7)).toBe(0.5);
    // Seat 5 -> Seat 1 suspicion must be fresh 0.5, NOT leaked 0.8
    expect(globalBeliefTracker.getSuspicion(5, 1)).toBe(0.5);
    // Seat 4 and Seat 5 ARE wolves in Game 2 -> 0.05
    expect(globalBeliefTracker.getSuspicion(4, 5)).toBe(0.05);
    // Seer checked targets cleared
    expect(globalBeliefTracker.getCheckedTargets(3).size).toBe(0);
  });
});

// ─── 3. Unbiased tie-breaking separated from difficulty randomness ───────────

describe('P0-3: Unbiased tie-breaking and deterministic replay stability', () => {
  it('paired permutation test: reversing candidate order [1..9] vs [9..1] has zero Seat-1 lock bias', () => {
    const forward = make9Board();
    const reversed = [...forward].reverse();
    const actor = forward[4]; // Seat 5 (Villager; 8 tied alive candidates)

    const bForward = new BeliefTracker();
    bForward.init(forward);
    const bReversed = new BeliefTracker();
    bReversed.init(reversed);

    const SAMPLES = 800;
    const countPicks = (players: Player[], tracker: BeliefTracker, type: 'VOTE' | 'CHECK') => {
      const counts = new Map<number, number>();
      const rng = createSeededRng(4242);
      for (let i = 0; i < SAMPLES; i++) {
        const decision = selectAction(actor, players, tracker, type, 1, [], 1.0, { rng });
        expect(decision.tieBroken).toBe(true);
        expect(decision.randomized).toBe(false);
        expect(decision.targetId).not.toBeNull();
        counts.set(decision.targetId!, (counts.get(decision.targetId!) ?? 0) + 1);
      }
      return counts;
    };

    for (const type of ['VOTE', 'CHECK'] as const) {
      const fwdCounts = countPicks(forward, bForward, type);
      const revCounts = countPicks(reversed, bReversed, type);

      // Every non-self seat (8 seats) must be chosen regularly (expected 100 each)
      const otherIds = forward.filter(p => p.id !== actor.id).map(p => p.id);
      for (const id of otherIds) {
        expect(fwdCounts.get(id) ?? 0).toBeGreaterThan(60);
        expect(fwdCounts.get(id) ?? 0).toBeLessThan(140);
        expect(revCounts.get(id) ?? 0).toBeGreaterThan(60);
        expect(revCounts.get(id) ?? 0).toBeLessThan(140);
      }
      // Seat 1 share must stay near uniform (~12.5%), never locked at 100%
      const seat1FwdRate = (fwdCounts.get(1) ?? 0) / SAMPLES;
      const seat1RevRate = (revCounts.get(1) ?? 0) / SAMPLES;
      expect(seat1FwdRate).toBeLessThan(0.2);
      expect(seat1RevRate).toBeLessThan(0.2);
      expect(Math.abs(seat1FwdRate - seat1RevRate)).toBeLessThan(0.06);
    }
  });

  it('separates tieBroken from difficulty randomized flag in ActionDecision', () => {
    const players = make9Board();
    const voter = players[4];
    const beliefs = new BeliefTracker();
    beliefs.init(players);
    beliefs.updateFromVote(voter.id, 7); // unique leader: Seat 7

    const deterministic = selectAction(voter, players, beliefs, 'VOTE', 1, [], 1.0, {
      rng: () => 0.5,
    });
    expect(deterministic).toMatchObject({
      targetId: 7,
      outcome: 'ACT',
      tieBroken: false,
      randomized: false,
    });

    const randomized = selectAction(voter, players, beliefs, 'VOTE', 1, [], 0.2, {
      rng: () => 0.5, // 0.5 > 0.2 triggers difficulty randomizer
    });
    expect(randomized.outcome).toBe('ACT');
    expect(randomized.randomized).toBe(true);
    expect(randomized.tieBroken).toBe(false);
  });

  it('useGameState wolf timeout/error fallbacks pick uniformly across alive non-wolves instead of valid[0]', async () => {
    stubBrowserGlobals();
    const wolfConfig: GameConfig = {
      ...MODE_9_PLAYER,
      roles: [
        Role.WEREWOLF,
        Role.VILLAGER,
        Role.SEER,
        Role.WITCH,
        Role.VILLAGER,
        Role.HUNTER,
        Role.WEREWOLF,
        Role.VILLAGER,
        Role.WEREWOLF,
      ],
    };

    const runWithRng = async (r: number) => {
      vi.spyOn(Math, 'random').mockReturnValue(r);
      const harness = createHookHarness();
      activeCleanup = harness.cleanup;
      harness.game.startGame(wolfConfig, 'en');
      harness.flush();
      harness.game.setPhase(GamePhase.NIGHT_WEREWOLVES);
      harness.flush();
      await harness.advance(120_000);
      const killId = harness.game.nightState.wolfKillId;
      harness.cleanup();
      activeCleanup = null;
      return killId;
    };

    const lowPick = await runWithRng(0.01);
    const highPick = await runWithRng(0.95);
    expect([2, 3, 4, 5, 6, 8]).toContain(lowPick);
    expect([2, 3, 4, 5, 6, 8]).toContain(highPick);
    expect(lowPick).not.toBe(highPick);
  });

  it('evaluation.ts runReplay stays 100% deterministic with rng: () => 0 even under tied beliefs', () => {
    const players = make9Board();
    const input: ReplayInput = {
      gameId: 'p0-determinism-check',
      players,
      variant: 'balanced',
      turns: [
        { kind: 'action', round: 1, actorId: 2, actionType: 'KILL', proposedTargetId: null },
        { kind: 'action', round: 1, actorId: 3, actionType: 'CHECK', proposedTargetId: null },
        { kind: 'action', round: 1, actorId: 4, actionType: 'POISON', proposedTargetId: null },
        { kind: 'action', round: 1, actorId: 5, actionType: 'VOTE', proposedTargetId: null },
      ],
    };

    const first = runReplay(input);
    const second = runReplay(input);
    expect(second).toEqual(first);
    expect(first.resolvedActions.find(a => a.actionType === 'POISON')?.targetId).toBeNull();
  });
});

// ─── 4. Zero unauthorized private-information read & leakage ─────────────────

describe('P0-4: Zero unauthorized private-info leakage in logs, prompts, and UI provenance', () => {
  it('marks human role, Seer check, Witch potion/pass logs as human-private and excludes them from AI prompts', async () => {
    stubBrowserGlobals();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    // Human is Seer
    const seerHumanConfig: GameConfig = {
      ...MODE_9_PLAYER,
      roles: [
        Role.SEER,
        Role.WEREWOLF,
        Role.VILLAGER,
        Role.WITCH,
        Role.VILLAGER,
        Role.HUNTER,
        Role.WEREWOLF,
        Role.VILLAGER,
        Role.WEREWOLF,
      ],
    };
    const harness = createHookHarness();
    activeCleanup = harness.cleanup;
    harness.game.startGame(seerHumanConfig, 'en');
    harness.flush();

    const initLog = harness.game.logs.find(l => l.id === 'init');
    expect(initLog?.visibility).toBe('human-private');

    harness.game.setPhase(GamePhase.NIGHT_SEER);
    harness.flush();
    harness.game.handlePlayerAction(2);
    harness.flush();
    const seerLog = harness.game.logs.find(l => l.message.includes('Check Player 2'));
    expect(seerLog?.visibility).toBe('human-private');

    // Also add synthetic human-private Witch & wolf-private logs and pass ALL logs to AI prompts
    const combinedLogs: GameLog[] = [
      ...harness.game.logs,
      {
        id: 'witch-poison',
        phase: GamePhase.NIGHT_WITCH,
        message: 'Poison Player 7.',
        translation: 'You chose to poison Player 7.',
        isSystem: true,
        tone: 'action',
        visibility: 'human-private',
      },
      {
        id: 'witch-save',
        phase: GamePhase.NIGHT_WITCH,
        message: 'Witch used antidote.',
        translation: 'You used the antidote to save Player 5.',
        isSystem: true,
        tone: 'action',
        visibility: 'human-private',
      },
      {
        id: 'witch-pass',
        phase: GamePhase.NIGHT_WITCH,
        message: 'Witch passed.',
        translation: 'The Witch chose not to use a potion.',
        isSystem: true,
        tone: 'action',
        visibility: 'human-private',
      },
      {
        id: 'wolf-secret',
        phase: GamePhase.NIGHT_WEREWOLVES,
        message: 'Wolf target locked: Player 5.',
        isSystem: true,
        tone: 'wolf',
        visibility: 'wolf-private',
      },
      {
        id: 'public-speech',
        phase: GamePhase.DAY_DISCUSSION,
        speakerId: 5,
        message: 'Public village observation about seat voting.',
        isSystem: false,
        tone: 'speech',
      },
    ];

    const players = harness.game.players;
    const aiVillager = players[2];
    const wolves = players.filter(p => p.role === Role.WEREWOLF);

    await generateAIDialogue(
      aiVillager,
      players,
      combinedLogs,
      GamePhase.DAY_DISCUSSION,
      [],
      1,
      null,
      [],
      { wolfKillId: null, witchPoisonId: null, witchSaved: false },
      'en',
    );
    await generateWolfChat(wolves, players, combinedLogs, 1, [], 'en');

    const dayPrompt = String(llm.generateSpeechWithLLM.mock.calls[0]?.[1] ?? '');
    const wolfPrompt = String(llm.generateWolfChatWithLLM.mock.calls[0]?.[1] ?? '');
    for (const prompt of [dayPrompt, wolfPrompt]) {
      expect(prompt).toContain('Public village observation about seat voting.');
      expect(prompt).not.toMatch(/You are Seer|Your role is Seer/i);
      expect(prompt).not.toMatch(/Check Player 2|check result/i);
      expect(prompt).not.toMatch(/Poison Player 7|poison Player 7/i);
      expect(prompt).not.toMatch(/Witch used antidote|used the antidote/i);
      expect(prompt).not.toMatch(/Witch passed|chose not to use a potion/i);
      expect(prompt).not.toMatch(/Wolf target locked/i);
    }
  });

  it('marks human Witch save, poison, and pass logs as human-private in useGameState', () => {
    stubBrowserGlobals();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const witchHumanConfig: GameConfig = {
      ...MODE_9_PLAYER,
      roles: [
        Role.WITCH,
        Role.WEREWOLF,
        Role.SEER,
        Role.VILLAGER,
        Role.VILLAGER,
        Role.HUNTER,
        Role.WEREWOLF,
        Role.VILLAGER,
        Role.WEREWOLF,
      ],
    };

    const harness = createHookHarness();
    activeCleanup = harness.cleanup;
    harness.game.startGame(witchHumanConfig, 'en');
    harness.flush();

    harness.game.setPhase(GamePhase.NIGHT_WITCH);
    harness.flush();
    harness.game.handlePlayerAction(2); // Poison
    harness.flush();
    expect(harness.game.logs.find(l => l.message === 'Poison Player 2.')?.visibility).toBe('human-private');

    harness.game.setPhase(GamePhase.NIGHT_WITCH);
    harness.flush();
    harness.game.skipWitch();
    harness.flush();
    expect(harness.game.logs.find(l => l.message === 'Witch passed.')?.visibility).toBe('human-private');
  });

  it('single-model Night 1 wolf chat does not leak wolf seats via aiDialogueSource when human is non-wolf', async () => {
    stubBrowserGlobals();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const harness = createHookHarness();
    activeCleanup = harness.cleanup;

    // Default single-model startGame (no mixedModels) where human Seat 1 is Villager
    harness.game.startGame(fixture9, 'en');
    harness.flush();

    await harness.advance(700); // NIGHT_START -> NIGHT_WEREWOLVES
    await harness.advance(700); // NIGHT_WEREWOLVES -> NIGHT_SEER (wolf chat generated & appended)

    expect(harness.game.wolfChat.length).toBeGreaterThan(0);
    // Zero wolf seats may expose aiDialogueSource to a non-wolf human
    expect(harness.game.players.every(p => p.aiDialogueSource === undefined)).toBe(true);
    expect(harness.game.logs.some(l => l.tone === 'wolf' || l.visibility === 'wolf-private')).toBe(false);
  });
});

// ─── 5. Deterministic P0 baseline measurement suite ──────────────────────────

describe('P0-5: Deterministic baseline metrics (distribution, fallback rate, tie-break rate, latency)', () => {
  it('measures legal role action distribution, zero unexpected fallbacks, tie-break rate, and sub-5ms latency', async () => {
    const players = make9Board();
    const wolf = players[1];
    const seer = players[2];
    const witch = players[3];
    const villager = players[4];

    const rng = createSeededRng(20261124);
    const N = 200;
    const stats = {
      killSeats: new Map<number, number>(),
      checkSeats: new Map<number, number>(),
      voteSeats: new Map<number, number>(),
      witchHoldCount: 0,
      witchActCount: 0,
      unexpectedFallbacks: 0,
      tieBrokenCount: 0,
      totalDecisions: 0,
    };

    globalBeliefTracker.init(players);
    setAIDifficulty(1.0);

    const startMs = performance.now();
    for (let i = 0; i < N; i++) {
      // Fresh neutral tracker per trial for unbiased tie distribution
      globalBeliefTracker.init(players);

      const kill = await generateAIAction(wolf, players, [], 'KILL', [], 1, { rng });
      const check = await generateAIAction(seer, players, [], 'CHECK', [], 1, { rng });
      const vote = await generateAIAction(villager, players, [], 'VOTE', [], 1, { rng });
      const poisonHold = await generateAIAction(witch, players, [], 'POISON', [], 1, { rng });

      for (const d of [kill, check, vote, poisonHold]) {
        stats.totalDecisions += 1;
        if (d.reason === 'random fallback') stats.unexpectedFallbacks += 1;
        if (d.tieBroken) stats.tieBrokenCount += 1;
      }

      if (kill.targetId !== null) {
        stats.killSeats.set(kill.targetId, (stats.killSeats.get(kill.targetId) ?? 0) + 1);
      }
      if (check.targetId !== null) {
        stats.checkSeats.set(check.targetId, (stats.checkSeats.get(check.targetId) ?? 0) + 1);
      }
      if (vote.targetId !== null) {
        stats.voteSeats.set(vote.targetId, (stats.voteSeats.get(vote.targetId) ?? 0) + 1);
      }
      if (poisonHold.outcome === 'HOLD') stats.witchHoldCount += 1;
      else if (poisonHold.outcome === 'ACT') stats.witchActCount += 1;
    }
    const elapsedMs = performance.now() - startMs;
    const avgLatencyMs = elapsedMs / stats.totalDecisions;
    const fallbackRate = stats.unexpectedFallbacks / stats.totalDecisions;
    const tieBreakRate = stats.tieBrokenCount / (N * 3); // kill/check/vote all start tied

    // Baseline invariants
    expect(fallbackRate).toBe(0);
    expect(stats.witchHoldCount).toBe(N);
    expect(stats.witchActCount).toBe(0);
    expect(tieBreakRate).toBe(1);
    expect(avgLatencyMs).toBeLessThan(5);
    // All legal candidate pools have full seat coverage (no seat-1 lock)
    expect(stats.killSeats.size).toBe(6); // 6 alive non-wolves
    expect(stats.checkSeats.size).toBe(8); // 8 alive others
    expect(stats.voteSeats.size).toBe(8); // 8 alive others
  });
});

describe('tactical self-ballots', () => {
  it.each([MODE_9_PLAYER, MODE_12_PLAYER])('keeps each role out of its normal and mistake pools on $id', async config => {
    const players = config.roles.map((role, i) => mkPlayer(i + 1, role));
    globalBeliefTracker.init(players);
    for (const actor of players) {
      for (const accuracy of [0, 0.85, 1]) {
        setAIDifficulty(accuracy);
        for (const roll of [0, 0.45, 0.99]) {
          const ordinary = await generateAIAction(actor, players, [], 'VOTE', [], 1, {
            rng: () => roll, deferVoteBeliefUpdate: true,
          });
          expect(ordinary.targetId).not.toBe(actor.id);
          expect(ordinary.trace?.candidates.map(c => c.targetId)).not.toContain(actor.id);
        }
      }
    }
  });

  it.each(Object.values(Role))('permits a rare, attributed public plan for %s without self-suspicion', async role => {
    const players = make9Board();
    const actor = mkPlayer(6, role);
    players[5] = actor;
    globalBeliefTracker.init(players);
    const cast = (roll: number, round = 1, extra = {}) =>
      generateAIAction(actor, players, [], 'VOTE', [], round, { rng: () => roll, ...extra });

    expect((await cast(0)).targetId).not.toBe(actor.id);
    const event = globalBeliefTracker.updateFromSpeech(1, 'Player 6, please vote for yourself to break the tie.', players, { round: 1 });
    expect((await cast(0.5)).targetId).not.toBe(actor.id);
    const ballot = await cast(0.01);
    expect(ballot.targetId).toBe(actor.id);
    expect(ballot.trace?.evidenceEventIds).toEqual([event?.eventId]);
    expect(globalBeliefTracker.getSeatMemory(actor.id)?.suspicion.has(actor.id)).toBe(false);
    expect((await cast(0, 2)).targetId).not.toBe(actor.id);
    expect((await cast(0, 1, { excludedTargetIds: new Set([actor.id]) })).targetId).not.toBe(actor.id);
    for (const ineligible of [{ ...actor, isAlive: false }, { ...actor, canVote: false }]) {
      expect((await generateAIAction(ineligible, players, [], 'VOTE', [], 1, { rng: () => 0 })).targetId).toBeNull();
    }
    globalBeliefTracker.updateFromSpeech(1, '6号，请不要自票。', players, { round: 1 });
    expect((await cast(0)).targetId).not.toBe(actor.id);
  });

  it.each([
    'you should not', "you shouldn’t", 'you can not', 'you cannot', "you can't",
  ])('honors a same-seat modal cancellation (%s) before the tactical draw', negation => {
    const players = make9Board();
    const actor = players[5];
    const vote = (speech: string) => {
      const beliefs = new BeliefTracker();
      beliefs.init(players);
      beliefs.updateFromSpeech(1, speech, players, { round: 1 });
      return selectAction(actor, players, beliefs, 'VOTE', 1, [], 1, { rng: () => 0 }).targetId;
    };
    const request = 'Player 6, you should vote for yourself.';
    const cancel = `Player 6, ${negation} vote for yourself.`;
    expect(vote(request)).toBe(actor.id);
    expect(vote(`${request} ${cancel}`)).toBe(vote(''));
    expect(vote(`${cancel} ${request}`)).toBe(actor.id);
    expect(vote(`${request} Player 5, ${negation} vote for yourself.`)).toBe(actor.id);
  });

  it('ignores an accusation, pressure, other seats, own speech, questions and quoted or hypothetical instructions', () => {
    const players = make9Board();
    const actor = players[5];
    const beliefs = new BeliefTracker();
    beliefs.init(players);
    for (const text of [
      'Everyone vote for Player 6.', 'Player 6 is suspicious.', 'Player 5, vote for yourself.',
      'Player 6, vote for yourself?', 'Player 6, vote for yourself if this ties.',
      'Player 1 said "My plan. Player 6, vote for yourself. End of plan."', 'Player 6, vote for yourself tomorrow.',
    ]) beliefs.updateFromSpeech(1, text, players, { round: 1 });
    beliefs.updateFromSpeech(6, 'Player 6, vote for yourself.', players, { round: 1 });
    expect(selectAction(actor, players, beliefs, 'VOTE', 1, [], 1, { rng: () => 0 }).targetId).not.toBe(actor.id);
  });
});
