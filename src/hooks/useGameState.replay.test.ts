import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GamePhase, Role, type GameConfig } from '../types';
import { MODE_9_PLAYER, MODE_12_PLAYER } from '../constants';

// Same dependency-aware hook runner as useGameState.matchTelemetry.test.ts:
// it runs the real hook, effects, timers and async continuations without a DOM.
const hooks = vi.hoisted(() => ({
  values: [] as unknown[], cursor: 0, dirty: true,
  effects: new Map<number, { deps?: readonly unknown[]; cleanup?: () => void }>(),
  pending: [] as (() => void)[],
}));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [hooks.values[index] as T, (next: T | ((previous: T) => T)) => {
        const previous = hooks.values[index] as T;
        const value = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
        if (!Object.is(previous, value)) { hooks.values[index] = value; hooks.dirty = true; }
      }] as const;
    },
    useRef: <T,>(value: T) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = { current: value };
      return hooks.values[index] as { current: T };
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const index = hooks.cursor++;
      const previous = hooks.effects.get(index);
      if (previous && deps && previous.deps?.length === deps.length && deps.every((v, i) => Object.is(v, previous.deps?.[i]))) return;
      hooks.pending.push(() => {
        previous?.cleanup?.();
        hooks.effects.set(index, { deps, cleanup: effect() || undefined });
      });
    },
  };
});
const ai = vi.hoisted(() => ({
  generateAIAction: vi.fn(), generateAIDialogue: vi.fn(), generateWolfChat: vi.fn(),
  resetAIMemory: vi.fn(), setAIDifficulty: vi.fn(),
}));
vi.mock('../ai/aiOrchestrator', () => ai);
const audio = vi.hoisted(() => ({
  cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), reset: vi.fn(), setMuted: vi.fn(),
  setVolume: vi.fn(), setRate: vi.fn(), setEnabled: vi.fn(), enqueue: vi.fn(),
  speechLangTag: vi.fn(() => 'en-US'),
}));
vi.mock('../services/speechAudio', () => audio);
const service = vi.hoisted(() => ({ isSupabaseConfigured: vi.fn(() => false), saveGameRecord: vi.fn(), fetchGameRecords: vi.fn() }));
vi.mock('../services/supabaseClient', () => service);
const engine = vi.hoisted(() => ({ applyElimination: vi.fn(), applyNightResolution: vi.fn() }));
vi.mock('../gameEngine', async importOriginal => {
  const actual = await importOriginal<typeof import('../gameEngine')>();
  return { ...actual, applyElimination: engine.applyElimination, applyNightResolution: engine.applyNightResolution };
});

import { globalBeliefTracker } from '../ai/beliefTracker';
import { REPLAY_STORAGE_KEY, clearReplays, listReplays } from '../replay';
import { useGameState, type AuthContext } from './useGameState';

const MY_PLAYER_ID = 1;
const fixture9: GameConfig = {
  ...MODE_9_PLAYER,
  roles: [Role.VILLAGER, Role.WEREWOLF, Role.SEER, Role.WITCH, Role.VILLAGER, Role.HUNTER, Role.WEREWOLF, Role.VILLAGER, Role.WEREWOLF],
};
const fixture12: GameConfig = {
  ...MODE_12_PLAYER,
  // Human seat 1 is the Seer, so the human check path is exercised on 12 seats.
  roles: [
    Role.SEER,
    Role.WEREWOLF, Role.WEREWOLF, Role.WEREWOLF, Role.WEREWOLF,
    Role.VILLAGER, Role.VILLAGER, Role.VILLAGER, Role.VILLAGER,
    Role.WITCH, Role.HUNTER, Role.IDIOT,
  ],
};

let game: ReturnType<typeof useGameState>;
let auth: AuthContext;
let values: Map<string, string>;
let killTargets: number[];
let checkTargets: number[];

const flush = () => {
  for (let i = 0; hooks.dirty; i++) {
    if (i > 40) throw new Error('Hook render did not settle');
    hooks.dirty = false; hooks.cursor = 0;
    game = useGameState(auth);
    for (const effect of hooks.pending.splice(0)) effect();
  }
};
const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); flush(); } };
const advance = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); await settle(); };

const start = (config: GameConfig) => {
  game.startGame(config, 'en');
  flush();
  // The real tracker would be initialized by the first AI call; the orchestrator
  // is mocked here, so seed it with the live roster explicitly.
  globalBeliefTracker.init(game.players);
};

const advanceUntilPhase = async (phase: GamePhase, limit = 20) => {
  for (let i = 0; i < limit && game.phase !== phase; i += 1) await advance(800);
  expect(game.phase).toBe(phase);
};

/** Answers the human turn whenever it arrives and walks to DAY_VOTING. */
const runDiscussion = async () => {
  for (let i = 0; i < 40 && game.phase === GamePhase.DAY_DISCUSSION; i += 1) {
    if (game.currentSpeaker?.id === MY_PLAYER_ID) {
      game.setUserInput(`Human speech ${i}: Player 2 looks like a wolf.`);
      flush();
      game.handleHumanSpeechSubmit();
      flush();
    }
    await advance(700);
  }
  expect(game.phase).toBe(GamePhase.DAY_VOTING);
};

const resolveVote = async (targetId: number) => {
  const vote = game.finishVote(targetId);
  flush();
  for (let i = 0; i < 20 && game.phase === GamePhase.DAY_VOTING; i += 1) await advance(200);
  await vote;
  await settle();
};

beforeEach(async () => {
  vi.useFakeTimers();
  hooks.values = []; hooks.cursor = 0; hooks.dirty = true; hooks.effects.clear(); hooks.pending = [];
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval, location: { port: '4175' } });
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  clearReplays();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  Object.values(ai).forEach(mock => mock.mockReset());
  Object.values(audio).forEach(mock => mock.mockClear());
  audio.enqueue.mockReset().mockResolvedValue(undefined);
  killTargets = [];
  checkTargets = [];
  ai.generateAIAction.mockImplementation(async (_player, _players, _logs, type) => {
    if (type === 'KILL') return { targetId: killTargets.shift() ?? null };
    if (type === 'CHECK') return { targetId: checkTargets.shift() ?? null };
    if (type === 'VOTE') return { targetId: 2, reason: 'Fixture vote reason from the seat.' };
    return { targetId: null };
  });
  ai.generateAIDialogue.mockImplementation(async (speaker: { id: number }) => ({
    en: `Fixture statement from Player ${speaker.id}.`,
    zh: `玩家${speaker.id}号的测试发言。`,
  }));
  ai.generateWolfChat.mockImplementation(async (wolves: Array<{ id: number }>, _players, _logs, round: number) => [{
    id: `wolf-${round}`,
    round,
    speakerId: wolves[0].id,
    message: `Night ${round}: push Player 1.`,
    strategyTag: '刀口' as const,
  }]);
  engine.applyElimination.mockReset();
  const actualEngine = await vi.importActual<typeof import('../gameEngine')>('../gameEngine');
  engine.applyNightResolution.mockReset();
  engine.applyNightResolution.mockImplementation(actualEngine.applyNightResolution);
  auth = {
    session: null, isGuest: true, profile: null, records: [], recordError: '', authEmail: '',
    guestPrincipalId: 'guest:11111111-1111-4111-8111-111111111111', publicName: 'Guest Fixture',
    setRecords: vi.fn(next => { auth.records = typeof next === 'function' ? next(auth.records) : next; hooks.dirty = true; }),
    setRecordError: vi.fn(next => { auth.recordError = typeof next === 'function' ? next(auth.recordError) : next; hooks.dirty = true; }),
  };
  flush();
});

afterEach(() => {
  for (const effect of hooks.effects.values()) effect.cleanup?.();
  clearReplays();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('H2-A replay capture wiring', () => {
  it('captures one 9-player replay, only after GAME_OVER, with speeches, votes, reasons, checks, wolf chat and beliefs', async () => {
    start(fixture9);
    killTargets = [8, 8];
    checkTargets = [2, 7];

    // Round 1: night pipeline -> discussion -> vote.
    await advanceUntilPhase(GamePhase.NIGHT_WEREWOLVES);
    await advanceUntilPhase(GamePhase.DAY_DISCUSSION);
    expect(listReplays()).toEqual([]);
    expect(values.has(REPLAY_STORAGE_KEY)).toBe(false);

    await runDiscussion();
    expect(listReplays()).toEqual([]);
    expect(values.has(REPLAY_STORAGE_KEY)).toBe(false);
    await resolveVote(2);
    expect(game.phase).toBe(GamePhase.NIGHT_START);
    expect(listReplays()).toEqual([]);
    expect(values.has(REPLAY_STORAGE_KEY)).toBe(false);

    // Round 2: same pipeline, then force the village win on the exile.
    await advanceUntilPhase(GamePhase.NIGHT_WEREWOLVES);
    await advanceUntilPhase(GamePhase.DAY_DISCUSSION);
    await runDiscussion();
    expect(listReplays()).toEqual([]);

    engine.applyElimination.mockReturnValueOnce({ players: game.players, winner: 'VILLAGERS', eliminated: true, sparedByIdiot: false });
    await resolveVote(7);
    expect(game.phase).toBe(GamePhase.GAME_OVER);
    expect(game.winner).toBe('VILLAGERS');

    const replays = listReplays();
    expect(replays).toHaveLength(1);
    const replay = replays[0];
    expect(replay.schemaVersion).toBe(1);
    expect(replay.boardId).toBe(MODE_9_PLAYER.id);
    expect(replay.difficulty).toBe('normal');
    expect(replay.language).toBe('en');
    expect(replay.isGuest).toBe(true);
    expect(replay.gameId).toMatch(/[0-9a-f-]{8,}/i);
    expect(replay.players).toHaveLength(9);
    expect(replay.players.map(player => player.seat)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const seat of replay.players) {
      expect(Object.keys(seat).sort()).toEqual(['isHuman', 'role', 'seat']);
      expect(seat).not.toHaveProperty('name');
    }
    expect(replay.outcome).toEqual({ winner: 'VILLAGERS', rounds: 2 });

    // Every public speech is present, in order, including the human lines.
    const speechLogs = game.logs.filter(log => !log.isSystem && log.tone === 'speech');
    expect(speechLogs.some(log => log.speakerId === MY_PLAYER_ID)).toBe(true);
    expect(replay.speeches.map(speech => speech.text)).toEqual(speechLogs.map(log => log.message));
    expect(replay.speeches.map(speech => speech.speakerId)).toEqual(speechLogs.map(log => log.speakerId));

    // Every vote of both rounds, including the AI reasons.
    expect(replay.votes).toHaveLength(9 + 8);
    for (const round of [1, 2]) {
      expect(replay.votes.filter(vote => vote.round === round)).toHaveLength(round === 1 ? 9 : 8);
    }
    const aiVotes = replay.votes.filter(vote => vote.voterId !== MY_PLAYER_ID);
    expect(aiVotes).toHaveLength(15);
    expect(aiVotes.every(vote => vote.reason === 'Fixture vote reason from the seat.')).toBe(true);
    expect(replay.votes.filter(vote => vote.voterId === MY_PLAYER_ID).every(vote => !('reason' in vote))).toBe(true);

    // AI seer check chain, one per round.
    expect(replay.checks).toEqual([
      { round: 1, actorId: 3, targetId: 2, isGood: false },
      { round: 2, actorId: 3, targetId: 7, isGood: false },
    ]);

    // Wolf night chat, one per round.
    expect(replay.wolfChat.map(entry => entry.round)).toEqual([1, 2]);
    expect(replay.wolfChat.every(entry => entry.message.startsWith('Night '))).toBe(true);

    // Belief snapshots: living AI seats only, filtered to living targets.
    expect(replay.beliefSnapshots.filter(snapshot => snapshot.round === 1)).toHaveLength(8);
    expect(replay.beliefSnapshots.filter(snapshot => snapshot.round === 2)).toHaveLength(7);
    for (const snapshot of replay.beliefSnapshots) {
      const expectedAlive = snapshot.round === 1 ? 9 : 8;
      expect(snapshot.scores).toHaveLength(expectedAlive - 1);
      expect(new Set(snapshot.scores.map(score => score.targetId)).size).toBe(snapshot.scores.length);
      expect(snapshot.scores.every(score => score.score >= 0 && score.score <= 1)).toBe(true);
    }

    // Phase sequence starts at round 0 and ends at GAME_OVER.
    expect(replay.phases[0]).toEqual({ phase: GamePhase.NIGHT_START, round: 0 });
    expect(replay.phases.at(-1)).toEqual({ phase: GamePhase.GAME_OVER, round: 2 });
    expect(replay.phases).toEqual(expect.arrayContaining([
      { phase: GamePhase.NIGHT_WEREWOLVES, round: 1 },
      { phase: GamePhase.DAY_DISCUSSION, round: 1 },
      { phase: GamePhase.DAY_VOTING, round: 1 },
      { phase: GamePhase.NIGHT_WEREWOLVES, round: 2 },
      { phase: GamePhase.DAY_VOTING, round: 2 },
    ]));

    // No PII: neither the human public name nor AI display names are written.
    const serialized = JSON.stringify(replay);
    expect(serialized).not.toContain(auth.publicName);
    expect(serialized).not.toContain('Guest Fixture');
    expect(serialized).not.toContain('alice@example.test');

    // Repeated renders / leaving / a second save cannot add a second record.
    hooks.dirty = true; flush(); flush();
    game.leaveGame(); flush();
    expect(listReplays()).toHaveLength(1);
    expect(JSON.parse(values.get(REPLAY_STORAGE_KEY)!).replays).toHaveLength(1);
  });

  it('finalizes a night-ending match with a final belief snapshot and no votes', async () => {
    start(fixture9);
    killTargets = [3];
    checkTargets = [5];
    const deadPlayers = game.players.map(player => player.id === 2
      ? { ...player, isAlive: false, canVote: false }
      : player);
    engine.applyNightResolution.mockReturnValueOnce({ deadIds: [2], players: deadPlayers, winner: 'VILLAGERS' });

    await advanceUntilPhase(GamePhase.NIGHT_WITCH);
    expect(listReplays()).toEqual([]);
    expect(values.has(REPLAY_STORAGE_KEY)).toBe(false);

    await advanceUntilPhase(GamePhase.GAME_OVER, 12);
    expect(game.winner).toBe('VILLAGERS');
    expect(listReplays()).toHaveLength(1);
    const replay = listReplays()[0];
    expect(replay.outcome).toEqual({ winner: 'VILLAGERS', rounds: 1 });
    expect(replay.votes).toEqual([]);
    expect(replay.speeches).toEqual([]);
    expect(replay.checks).toEqual([{ round: 1, actorId: 3, targetId: 5, isGood: true }]);
    expect(replay.beliefSnapshots).toHaveLength(7);
    for (const snapshot of replay.beliefSnapshots) {
      expect(snapshot.scores).toHaveLength(7);
      expect(snapshot.scores.every(score => score.score >= 0 && score.score <= 1)).toBe(true);
    }
    expect(replay.phases.at(-1)).toEqual({ phase: GamePhase.GAME_OVER, round: 1 });
    expect(replay.phases.some(entry => entry.phase === GamePhase.DAY_VOTING)).toBe(false);
    game.leaveGame(); flush();
    expect(listReplays()).toHaveLength(1);
  });

  it('captures a 12-player replay with the human seer check path', async () => {
    start(fixture12);
    killTargets = [10];
    checkTargets = [2];

    await advanceUntilPhase(GamePhase.NIGHT_WEREWOLVES);
    await advanceUntilPhase(GamePhase.NIGHT_SEER);
    // The human is the Seer: no AI driver fires here, the seat acts directly.
    game.handlePlayerAction(2);
    flush();
    expect(game.phase).toBe(GamePhase.NIGHT_WITCH);
    expect(game.aiSeerLastCheck).toEqual({ targetId: 2, isGood: false });

    await advanceUntilPhase(GamePhase.DAY_DISCUSSION);
    await runDiscussion();
    expect(listReplays()).toEqual([]);

    engine.applyElimination.mockReturnValueOnce({ players: game.players, winner: 'WEREWOLVES', eliminated: true, sparedByIdiot: false });
    await resolveVote(3);
    expect(game.phase).toBe(GamePhase.GAME_OVER);

    const replays = listReplays();
    expect(replays).toHaveLength(1);
    const replay = replays[0];
    expect(replay.boardId).toBe(MODE_12_PLAYER.id);
    expect(replay.players).toHaveLength(12);
    expect(replay.outcome).toEqual({ winner: 'WEREWOLVES', rounds: 1 });
    expect(replay.checks).toEqual([{ round: 1, actorId: MY_PLAYER_ID, targetId: 2, isGood: false }]);

    const speechLogs = game.logs.filter(log => !log.isSystem && log.tone === 'speech');
    expect(speechLogs.some(log => log.speakerId === MY_PLAYER_ID)).toBe(true);
    expect(replay.speeches.map(speech => speech.text)).toEqual(speechLogs.map(log => log.message));
    expect(replay.votes).toHaveLength(12);
    expect(replay.wolfChat).toHaveLength(1);

    expect(replay.beliefSnapshots.filter(snapshot => snapshot.round === 1)).toHaveLength(11);
    for (const snapshot of replay.beliefSnapshots) {
      expect(snapshot.scores).toHaveLength(11);
      expect(snapshot.scores.every(score => score.score >= 0 && score.score <= 1)).toBe(true);
    }
  });
});
