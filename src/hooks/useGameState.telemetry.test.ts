import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GamePhase, Role, type GameConfig } from '../types';
import { MODE_9_PLAYER } from '../constants';
import { MATCH_TELEMETRY_STORAGE_KEY, reset, snapshot } from '../services/matchTelemetry';

// A dependency-aware hook runner: executes the real hook, effects, timer
// callbacks and async continuations without requiring an installed DOM library.
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
const engine = vi.hoisted(() => ({ applyElimination: vi.fn() }));
vi.mock('../gameEngine', async importOriginal => {
  const actual = await importOriginal<typeof import('../gameEngine')>();
  return { ...actual, applyElimination: engine.applyElimination };
});

import { useGameState, type AuthContext } from './useGameState';

const fixture: GameConfig = {
  ...MODE_9_PLAYER,
  roles: [Role.VILLAGER, Role.WEREWOLF, Role.SEER, Role.WITCH, Role.VILLAGER, Role.HUNTER, Role.WEREWOLF, Role.VILLAGER, Role.WEREWOLF],
};
let game: ReturnType<typeof useGameState>;
let auth: AuthContext;
let values: Map<string, string>;
const flush = () => {
  for (let i = 0; hooks.dirty; i++) {
    if (i > 40) throw new Error('Hook render did not settle');
    hooks.dirty = false; hooks.cursor = 0;
    game = useGameState(auth);
    for (const effect of hooks.pending.splice(0)) effect();
  }
};
const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); flush(); } };
const advance = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); await settle(); };
const start = () => { game.startGame(fixture, 'en'); flush(); };
const leave = () => { game.leaveGame(); flush(); };

beforeEach(() => {
  vi.useFakeTimers();
  hooks.values = []; hooks.cursor = 0; hooks.dirty = true; hooks.effects.clear(); hooks.pending = [];
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval, location: { port: '4175' } });
  values = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  reset();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  Object.values(ai).forEach(mock => mock.mockReset());
  Object.values(audio).forEach(mock => mock.mockClear());
  audio.enqueue.mockReset().mockResolvedValue(undefined);
  ai.generateAIAction.mockResolvedValue({ targetId: null });
  ai.generateAIDialogue.mockResolvedValue({ en: 'A complete local fixture statement.', zh: '本地测试发言。' });
  ai.generateWolfChat.mockResolvedValue([]);
  engine.applyElimination.mockReset();
  auth = {
    session: null, isGuest: true, profile: null, records: [], recordError: '', authEmail: '',
    guestPrincipalId: 'guest:11111111-1111-4111-8111-111111111111', publicName: 'Guest Fixture',
    setRecords: vi.fn(next => { auth.records = typeof next === 'function' ? next(auth.records) : next; hooks.dirty = true; }),
    setRecordError: vi.fn(next => { auth.recordError = typeof next === 'function' ? next(auth.recordError) : next; }),
  };
  flush(); start();
});

afterEach(() => {
  for (const effect of hooks.effects.values()) effect.cleanup?.();
  reset();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('per-match telemetry wiring', () => {
  it('starts one aggregate from the selected board, difficulty, language, and guest flag', () => {
    const { current, matches } = snapshot();
    expect(matches).toEqual([]);
    expect(current).toMatchObject({
      boardId: MODE_9_PLAYER.id,
      difficulty: 'normal',
      language: 'en',
      isGuest: true,
      completed: false,
    });
    expect(values.has(MATCH_TELEMETRY_STORAGE_KEY)).toBe(false);
  });

  it('records a difficulty change before start in the new aggregate', () => {
    game.setDifficulty('hard'); flush();
    leave();
    start();
    expect(snapshot().current).toMatchObject({ difficulty: 'hard' });
  });

  it('closes an abandoned match with the active phase on leaveGame', () => {
    game.setPhase(GamePhase.DAY_DISCUSSION); flush();
    leave();
    const { current, matches } = snapshot();
    expect(current).toBeNull();
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      completed: false,
      winner: null,
      phaseAtEnd: GamePhase.DAY_DISCUSSION,
      boardId: MODE_9_PLAYER.id,
    });
    const stored = JSON.parse(values.get(MATCH_TELEMETRY_STORAGE_KEY)!);
    expect(stored.matches).toHaveLength(1);
  });

  it('closes a completed match once on GAME_OVER and never double-records leaveGame', async () => {
    engine.applyElimination.mockReturnValue({ players: game.players, winner: 'VILLAGERS' });
    game.setPhase(GamePhase.DAY_VOTING); flush();
    const vote = game.finishVote(2); flush();
    for (let i = 0; i < 12 && game.phase !== GamePhase.GAME_OVER; i += 1) await advance(200);
    await vote; await settle();

    expect(game.phase).toBe(GamePhase.GAME_OVER);
    expect(game.winner).toBe('VILLAGERS');
    expect(snapshot().current).toBeNull();
    expect(snapshot().matches).toHaveLength(1);
    expect(snapshot().matches[0]).toMatchObject({
      completed: true,
      winner: 'VILLAGERS',
      phaseAtEnd: 'GAME_OVER',
    });

    leave();
    expect(snapshot().matches).toHaveLength(1);
  });
});
