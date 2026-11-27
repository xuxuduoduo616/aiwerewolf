import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE_9_PLAYER } from '../constants';
import { getRoleCamp } from '../gameEngine';
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
import { selectAction } from './actionSelector';
import { generateAIAction, resetAIMemory, setAIDifficulty } from './aiOrchestrator';
import { BeliefTracker, globalBeliefTracker } from './beliefTracker';
import {
  canSeatRead,
  PlayerMemoryStore,
  WOLF_TEAMMATE_SUSPICION,
  type VisibleEvent,
} from './playerMemory';

const mkPlayer = (id: number, role: Role, isHuman = false): Player => ({
  id,
  name: isHuman ? 'Human' : `P${id}`,
  role,
  camp: getRoleCamp(role),
  isAlive: true,
  canVote: true,
  isRevealed: false,
  avatarUrl: '',
  aiPersonality: '',
  traits: [],
  aiModelLabel: '',
  isHuman,
  publicClaims: [],
  privateKnowledge: [],
  suspicionMap: {},
});

const make9Board = (): Player[] => [
  mkPlayer(1, Role.VILLAGER, true), // Human
  mkPlayer(2, Role.WEREWOLF),       // Wolf A
  mkPlayer(3, Role.SEER),           // Seer
  mkPlayer(4, Role.WEREWOLF),       // Wolf B (target of human speech test)
  mkPlayer(5, Role.WITCH),          // Witch
  mkPlayer(6, Role.HUNTER),         // Hunter
  mkPlayer(7, Role.WEREWOLF),       // Wolf C
  mkPlayer(8, Role.VILLAGER),       // AI listener Seat 8
  mkPlayer(9, Role.VILLAGER),       // AI listener Seat 9
];

describe('PlayerMemoryStore — visibility isolation, idempotency, and cross-game reset', () => {
  it('enforces strict per-seat visibility gating with 0 unauthorized reads', () => {
    const players = make9Board();
    const store = new PlayerMemoryStore();
    store.init(players);

    const seerPrivateEvent: VisibleEvent = {
      eventId: 'seer-r1-s3-t4',
      seq: store.nextSeq(),
      round: 1,
      phase: GamePhase.NIGHT_SEER,
      visibility: 'seat-private',
      visibleToSeatIds: [3],
      kind: 'seer-check',
      actorId: 3,
      payload: { seerId: 3, targetId: 4, isGood: false },
    };

    const witchPrivateEvent: VisibleEvent = {
      eventId: 'witch-r1-s5',
      seq: store.nextSeq(),
      round: 1,
      phase: GamePhase.NIGHT_WITCH,
      visibility: 'seat-private',
      visibleToSeatIds: [5],
      kind: 'witch-info',
      actorId: 5,
      payload: { wolfKillId: 8, saved: true },
    };

    const wolfTeamEvent: VisibleEvent = {
      eventId: 'wolf-r1-plan',
      seq: store.nextSeq(),
      round: 1,
      phase: GamePhase.NIGHT_WEREWOLVES,
      visibility: 'wolf-team',
      kind: 'wolf-plan',
      actorId: 2,
      payload: { message: 'Tonight kill Seat 8, Seat 2 fake-claim Seer', targetId: 8 },
    };

    store.ingestEvent(seerPrivateEvent, players);
    store.ingestEvent(witchPrivateEvent, players);
    store.ingestEvent(wolfTeamEvent, players);

    // Seer-private event readable ONLY by seat 3
    for (const player of players) {
      const expectedSeerRead = player.id === 3;
      expect(canSeatRead(store.getSeatMemory(player.id)!, seerPrivateEvent)).toBe(expectedSeerRead);
      expect(store.readEventForSeat(player.id, seerPrivateEvent) !== null).toBe(expectedSeerRead);
      expect(
        store.getVisibleEventsForSeat(player.id).some(e => e.eventId === seerPrivateEvent.eventId),
      ).toBe(expectedSeerRead);
    }

    // Witch-private event readable ONLY by seat 5
    for (const player of players) {
      const expectedWitchRead = player.id === 5;
      expect(store.readEventForSeat(player.id, witchPrivateEvent) !== null).toBe(expectedWitchRead);
      expect(
        store.getVisibleEventsForSeat(player.id).some(e => e.eventId === witchPrivateEvent.eventId),
      ).toBe(expectedWitchRead);
    }

    // Wolf-team event readable ONLY by wolves (2, 4, 7) — 0 leaks to good seats
    const wolfSeatIds = new Set([2, 4, 7]);
    for (const player of players) {
      const expectedWolfRead = wolfSeatIds.has(player.id);
      expect(store.readEventForSeat(player.id, wolfTeamEvent) !== null).toBe(expectedWolfRead);
      expect(
        store.getVisibleEventsForSeat(player.id).some(e => e.eventId === wolfTeamEvent.eventId),
      ).toBe(expectedWolfRead);
    }

    // Seer suspicion updated privately; non-seer Seat 8 untouched
    expect(store.getSeatMemory(3)!.suspicion.get(4)).toBe(1.0);
    expect(store.getSeatMemory(8)!.suspicion.get(4)).toBe(0.5);
  });

  it('makes eventId replay a strict no-op (zero double-weighting)', () => {
    const players = make9Board();
    const beliefs = new BeliefTracker();
    beliefs.init(players);

    const event = beliefs.updateFromSpeech(1, '4号是狼，今天投4号！', players, {
      round: 1,
      eventId: 'speech-r1-s1-fixed',
    });
    expect(event).not.toBeNull();

    const afterFirst = beliefs.getSuspicion(8, 4);
    const reasonsAfterFirst = beliefs.getRecentReasons(8, 4).length;
    expect(afterFirst).toBeGreaterThan(0.5);

    // Replay exact same eventId via both ingestEvent and updateFromSpeech
    expect(beliefs.ingestEvent(event!, players)).toBe(false);
    beliefs.updateFromSpeech(1, '4号是狼，今天投4号！', players, {
      round: 1,
      eventId: 'speech-r1-s1-fixed',
    });

    expect(beliefs.getSuspicion(8, 4)).toBe(afterFirst);
    expect(beliefs.getRecentReasons(8, 4).length).toBe(reasonsAfterFirst);
  });

  it('suppresses repeated accusations by the same speaker against the same target in the same round', () => {
    const players = make9Board();
    const single = new BeliefTracker();
    single.init(players);
    single.updateFromSpeech(1, 'Player 4 is a wolf.', players, { round: 1, eventId: 'e1' });

    const repeated = new BeliefTracker();
    repeated.init(players);
    repeated.updateFromSpeech(1, 'Player 4 is a wolf.', players, { round: 1, eventId: 'e1' });
    repeated.updateFromSpeech(1, 'Vote Player 4 now!', players, { round: 1, eventId: 'e2' });
    repeated.updateFromSpeech(1, 'Player 4 is definitely lying!', players, { round: 1, eventId: 'e3' });

    expect(repeated.getSuspicion(8, 4)).toBeCloseTo(single.getSuspicion(8, 4), 10);
  });

  it('protects Seer confirmed hard facts from being overwritten by public speech', () => {
    const players = make9Board();
    const beliefs = new BeliefTracker();
    beliefs.init(players);

    // Seer Seat 3 privately checks Seat 4 (wolf -> 1.0) and Seat 8 (good -> 0.0)
    beliefs.recordSeerCheck(3, 4, false, { round: 1 });
    beliefs.recordSeerCheck(3, 8, true, { round: 2 });

    // Other seats publicly defend Seat 4 and accuse Seat 8
    beliefs.updateFromSpeech(1, 'I trust Player 4, Player 8 is a wolf!', players, { round: 2 });
    beliefs.updateFromSpeech(2, '我是预言家，昨晚验了4号金水，8号是查杀！', players, { round: 2 });

    expect(beliefs.getSuspicion(3, 4)).toBe(1.0);
    expect(beliefs.getSuspicion(3, 8)).toBe(0.0);
  });

  it('clears all seat memories cleanly on reset() / new game init()', () => {
    const players = make9Board();
    const beliefs = new BeliefTracker();
    beliefs.init(players);

    beliefs.recordSeerCheck(3, 4, false, { round: 1 });
    beliefs.updateFromSpeech(1, 'Player 4 is a wolf!', players, { round: 1, eventId: 'game1-e1' });
    expect(beliefs.getSuspicion(8, 4)).toBeGreaterThan(0.5);
    expect(beliefs.getSeatMemory(8)?.seenEventIds.has('game1-e1')).toBe(true);

    beliefs.reset();
    expect(beliefs.getSeatMemory(8)).toBeUndefined();
    expect(beliefs.snapshot(8)).toEqual([]);
    expect(beliefs.getCheckedTargets(3).size).toBe(0);

    // Re-init for Game 2: eventId 'game1-e1' is no longer remembered and scores are fresh
    beliefs.init(players);
    expect(beliefs.getSuspicion(8, 4)).toBe(0.5);
    expect(beliefs.getSeatMemory(8)?.seenEventIds.size).toBe(0);
    expect(beliefs.getRecentReasons(8)).toEqual([]);
  });
});

describe('BeliefTracker — multi-target listener belief direction', () => {
  it('lowers suspicion on trusted target and raises suspicion on accused target (zh + en)', () => {
    const players = make9Board();

    const zhTracker = new BeliefTracker();
    zhTracker.init(players);
    zhTracker.updateFromSpeech(1, '我信 3 号，7 号才是狼', players, { round: 1 });

    // AI listener Seat 8: suspicion on 3 goes DOWN (<0.5), suspicion on 7 goes UP (>0.5)
    expect(zhTracker.getSuspicion(8, 3)).toBeLessThan(0.5);
    expect(zhTracker.getSuspicion(8, 7)).toBeGreaterThan(0.5);

    const enTracker = new BeliefTracker();
    enTracker.init(players);
    enTracker.updateFromSpeech(1, 'I trust Player 3, Player 7 is the wolf', players, { round: 1 });

    expect(enTracker.getSuspicion(8, 3)).toBeLessThan(0.5);
    expect(enTracker.getSuspicion(8, 7)).toBeGreaterThan(0.5);
  });
});

describe('Vertical paired test — human speech directly moves AI listener belief and vote', () => {
  it('changing ONLY human Seat 1 speech flips AI listener Seat 8 suspicion and vote target (selectAction + generateAIAction)', async () => {
    const players = make9Board();
    const listener = players.find(p => p.id === 8)!;
    const fixedRng = () => 0.1;

    // Run A: Human Seat 1 accuses Seat 4
    const trackerAccuse = new BeliefTracker();
    trackerAccuse.init(players);
    trackerAccuse.updateFromSpeech(1, 'Player 4 is definitely a wolf, everyone vote Player 4 today.', players, {
      round: 1,
      eventId: 'human-r1-accuse',
    });

    // Run B: Human Seat 1 defends Seat 4 (all other variables identical)
    const trackerDefend = new BeliefTracker();
    trackerDefend.init(players);
    trackerDefend.updateFromSpeech(1, 'I trust Player 4, Player 4 is a confirmed good villager.', players, {
      round: 1,
      eventId: 'human-r1-defend',
    });

    const susAccuse = trackerAccuse.getSuspicion(8, 4);
    const susDefend = trackerDefend.getSuspicion(8, 4);
    expect(susAccuse).toBeGreaterThan(0.5);
    expect(susDefend).toBeLessThan(0.5);
    expect(susAccuse).toBeGreaterThan(susDefend);

    const voteAccuse = selectAction(listener, players, trackerAccuse, 'VOTE', 1, [], 1.0, { rng: fixedRng });
    const voteDefend = selectAction(listener, players, trackerDefend, 'VOTE', 1, [], 1.0, { rng: fixedRng });

    expect(voteAccuse.outcome).toBe('ACT');
    expect(voteAccuse.targetId).toBe(4);
    expect(voteDefend.outcome).toBe('ACT');
    expect(voteDefend.targetId).not.toBe(4);

    // Also verify end-to-end through globalBeliefTracker + generateAIAction('VOTE')
    setAIDifficulty(1.0);
    globalBeliefTracker.init(players);
    globalBeliefTracker.updateFromSpeech(1, '4号铁狼，大家今天投4号。', players, { round: 1 });
    const aiVoteAccuse = await generateAIAction(listener, players, [], 'VOTE', [], 1, { rng: fixedRng });
    expect(aiVoteAccuse.targetId).toBe(4);

    globalBeliefTracker.init(players);
    globalBeliefTracker.updateFromSpeech(1, '我保4号，4号是好人，大家别投4号。', players, { round: 1 });
    const aiVoteDefend = await generateAIAction(listener, players, [], 'VOTE', [], 1, { rng: fixedRng });
    expect(aiVoteDefend.targetId).not.toBe(4);
  });
});

describe('Wolf bussing isolation — public stance vs locked internal teammate knowledge', () => {
  it('keeps wolf internal teammateIds and suspicion <= 0.05 across single and multi-round public bussing', () => {
    const players = make9Board();
    const beliefs = new BeliefTracker();
    beliefs.init(players);

    // Wolves are Seats 2, 4, 7
    const wolfA = 2;
    const wolfB = 4;
    const wolfC = 7;

    expect([...beliefs.getSeatMemory(wolfA)!.knownTeammateIds].sort((a, b) => a - b)).toEqual([4, 7]);
    expect(beliefs.getSuspicion(wolfA, wolfB)).toBe(WOLF_TEAMMATE_SUSPICION);
    expect(beliefs.getSuspicion(wolfC, wolfB)).toBe(WOLF_TEAMMATE_SUSPICION);

    // Wolf A publicly busses Wolf B across 3 consecutive rounds (and Seer/Villager also accuse Wolf B)
    for (let round = 1; round <= 3; round += 1) {
      beliefs.updateFromSpeech(
        wolfA,
        `Round ${round}: Player 4 is a wolf, vote Player 4 out immediately!`,
        players,
        { round, eventId: `bus-r${round}-a` },
      );
      beliefs.updateFromSpeech(
        1,
        `Round ${round}: I agree, Player 4 is definitely a werewolf, vote Player 4.`,
        players,
        { round, eventId: `villager-r${round}` },
      );
    }

    // Public stance records that Wolf A publicly accused Wolf B
    expect(beliefs.getSeatMemory(wolfA)!.publicStance.get(wolfB)).toBe('accuse');

    // Internal teammate sets and suspicions remain strictly locked <= 0.05 for ALL wolves
    expect([...beliefs.getSeatMemory(wolfA)!.knownTeammateIds].sort((a, b) => a - b)).toEqual([4, 7]);
    expect(beliefs.getSuspicion(wolfA, wolfB)).toBeLessThanOrEqual(WOLF_TEAMMATE_SUSPICION);
    expect(beliefs.getSuspicion(wolfC, wolfB)).toBeLessThanOrEqual(WOLF_TEAMMATE_SUSPICION);
    expect(beliefs.getSuspicion(wolfB, wolfA)).toBeLessThanOrEqual(WOLF_TEAMMATE_SUSPICION);

    // Meanwhile, Villager listener Seat 8 DID absorb the public bussing and suspects Wolf B strongly
    expect(beliefs.getSuspicion(8, wolfB)).toBeGreaterThan(0.75);
  });
});

describe('Contested Seer claims & credibility weighting', () => {
  it('marks counter-claiming Seers as contested, discounts contested check claims, and drops fake-seer credibility for the true Seer', () => {
    const players = make9Board();
    const beliefs = new BeliefTracker();
    beliefs.init(players);

    // True Seer Seat 3 claims Seer and gives check-wolf on Seat 4 (uncontested at this moment)
    beliefs.updateFromSpeech(3, '我是预言家，昨晚验了4号，是查杀。', players, {
      round: 1,
      eventId: 'seer-claim-3',
    });
    const uncontestedDelta = beliefs.getSuspicion(8, 4) - 0.5;
    expect(uncontestedDelta).toBeGreaterThan(0.1);

    // Wolf Seat 2 counter-claims Seer and gives check-wolf on Seat 6 (now contested!)
    beliefs.updateFromSpeech(2, '我是预言家，昨晚验了6号，是查杀。', players, {
      round: 1,
      eventId: 'seer-claim-2',
    });
    const contestedDelta = beliefs.getSuspicion(8, 6) - 0.5;

    // Both Seer claims are marked contested for listener Seat 8
    const claims = beliefs.getPublicRoleClaims(8);
    expect(claims.filter(c => c.claimedRole === Role.SEER)).toHaveLength(2);
    expect(claims.filter(c => c.claimedRole === Role.SEER).every(c => c.contested)).toBe(true);

    // Contested check-wolf delta is discounted by 0.6x relative to uncontested
    expect(contestedDelta).toBeCloseTo(uncontestedDelta * 0.6, 6);

    // True Seer Seat 3 sets fake-claiming Seat 2's credibility to 0.0 and suspicion >= 0.95 (isolated to Seer)
    expect(beliefs.getSeatMemory(3)!.credibility.get(2)).toBe(0.0);
    expect(beliefs.getSuspicion(3, 2)).toBeGreaterThanOrEqual(0.95);
    expect(beliefs.getRecentReasons(3, 2).some(r => r.tag === 'counter-seer-claim')).toBe(true);
    expect(beliefs.getSuspicion(8, 2)).toBe(0.5);
  });
});

describe('useGameState vertical wiring — human speech, AI speech dedupe, and leaveGame reset', () => {
  const fixture9: GameConfig = {
    ...MODE_9_PLAYER,
    roles: [
      Role.VILLAGER,
      Role.WEREWOLF,
      Role.SEER,
      Role.WEREWOLF,
      Role.WITCH,
      Role.HUNTER,
      Role.WEREWOLF,
      Role.VILLAGER,
      Role.VILLAGER,
    ],
  };

  let cleanupHook: (() => void) | null = null;

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
      guestPrincipalId: 'guest:p1a-test',
      publicName: 'P1ATester',
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
      for (let i = 0; hooks.dirty; i += 1) {
        if (i > 40) throw new Error('Hook render did not settle');
        hooks.dirty = false;
        hooks.cursor = 0;
        game = useGameState(auth);
        for (const effect of hooks.pending.splice(0)) effect();
      }
    };
    const settle = async () => {
      for (let i = 0; i < 20; i += 1) {
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
      advance,
      cleanup,
    };
  };

  beforeEach(() => {
    resetAIMemory();
    setAIDifficulty(1.0);
    llm.generateSpeechWithLLM.mockReset().mockResolvedValue(null);
    llm.generateWolfChatWithLLM.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    cleanupHook?.();
    cleanupHook = null;
    resetAIMemory();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const stubGlobals = () => {
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

  it('handleHumanSpeechSubmit immediately updates AI listener beliefs and leaveGame wipes SeatMemory', async () => {
    stubGlobals();
    vi.spyOn(Math, 'random').mockReturnValue(0.1);
    const harness = createHookHarness();
    cleanupHook = harness.cleanup;

    harness.game.startGame(fixture9, 'en');
    harness.flush();

    // Enter DAY_DISCUSSION with human Seat 1 as first speaker
    harness.game.setPhase(GamePhase.DAY_HUNTER_CHECK);
    harness.flush();
    await harness.advance(700); // DAY_HUNTER_CHECK -> DAY_DISCUSSION
    await harness.advance(700); // pops Seat 1 (human)
    expect(harness.game.currentSpeaker?.id).toBe(1);
    expect(globalBeliefTracker.getSuspicion(8, 4)).toBe(0.5);

    harness.game.setUserInput('Player 4 is a wolf, vote Player 4 today.');
    harness.flush();
    harness.game.handleHumanSpeechSubmit();
    harness.flush();

    // AI listener Seat 8 immediately absorbed the human's accusation on Seat 4
    expect(globalBeliefTracker.getSuspicion(8, 4)).toBeGreaterThan(0.5);
    const voteDecision = selectAction(
      harness.game.players.find(p => p.id === 8)!,
      harness.game.players,
      globalBeliefTracker,
      'VOTE',
      1,
      [],
      1.0,
      { rng: () => 0.1 },
    );
    expect(voteDecision.targetId).toBe(4);

    // Next speaker (Seat 2 AI) speaks — verify AI speech commit is NOT double-weighted
    llm.generateSpeechWithLLM.mockResolvedValueOnce({
      en: 'I think Player 6 is acting very suspicious today and everyone should look closely at Player 6 before voting.',
      zh: '',
    });
    await harness.advance(700);
    // Seat 8 should have recorded at most ONE reason from Seat 2 on target 6 (no double-weighting)
    const seat2ReasonsOn6 = globalBeliefTracker
      .getRecentReasons(8, 6)
      .filter(reason => reason.actorId === 2);
    expect(seat2ReasonsOn6).toHaveLength(1);

    // Leaving game resets all seat memories
    harness.game.leaveGame();
    harness.flush();
    expect(globalBeliefTracker.getSeatMemory(8)).toBeUndefined();
    expect(globalBeliefTracker.snapshot(8)).toEqual([]);
  });
});


