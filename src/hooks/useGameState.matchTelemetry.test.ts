import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GamePhase, Role, type GameConfig } from '../types';
import { MODE_9_PLAYER } from '../constants';
import {
  MATCH_TELEMETRY_STORAGE_KEY,
  PAGE_HIDDEN_GRACE_MS,
  reset,
  snapshot,
  summarizeMatches,
} from '../services/matchTelemetry';

// Same dependency-aware hook runner as useGameState.telemetry.test.ts: it
// executes the real hook, effects, timer callbacks and async continuations
// without requiring an installed DOM library.
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

// OBS-DENOM: fake page/document event targets. The hook installs the real
// page-lifecycle capture against these globals, so no DOM library is needed.
const createLifecycleTarget = () => {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const target = {
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.get(type)?.delete(listener);
    },
  };
  return {
    target,
    dispatch: (type: string) => {
      for (const listener of [...(listeners.get(type) ?? [])]) listener({ type } as Event);
    },
    count: (type: string) => listeners.get(type)?.size ?? 0,
  };
};
type FakeDocument = {
  visibilityState: string;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
};
let pageLifecycle: ReturnType<typeof createLifecycleTarget>;
let visibilityLifecycle: ReturnType<typeof createLifecycleTarget>;
let fakeDocument: FakeDocument;
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
const readStored = () => JSON.parse(values.get(MATCH_TELEMETRY_STORAGE_KEY)!);

beforeEach(() => {
  vi.useFakeTimers();
  hooks.values = []; hooks.cursor = 0; hooks.dirty = true; hooks.effects.clear(); hooks.pending = [];
  pageLifecycle = createLifecycleTarget();
  visibilityLifecycle = createLifecycleTarget();
  fakeDocument = {
    visibilityState: 'visible',
    addEventListener: visibilityLifecycle.target.addEventListener,
    removeEventListener: visibilityLifecycle.target.removeEventListener,
  };
  vi.stubGlobal('window', {
    setTimeout, clearTimeout, setInterval, clearInterval,
    location: { port: '4175' },
    addEventListener: pageLifecycle.target.addEventListener,
    removeEventListener: pageLifecycle.target.removeEventListener,
  });
  vi.stubGlobal('document', fakeDocument);
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
    setRecordError: vi.fn(next => { auth.recordError = typeof next === 'function' ? next(auth.recordError) : next; hooks.dirty = true; }),
  };
  flush(); start();
});

afterEach(() => {
  for (const effect of hooks.effects.values()) effect.cleanup?.();
  reset();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('match lifecycle wiring (completion and abandonment)', () => {
  it('records match_started from startGame with the selected setup', () => {
    leave();
    const stored = readStored();
    expect(stored.events).toHaveLength(2);
    expect(stored.events[0]).toMatchObject({
      type: 'match_started',
      boardId: MODE_9_PLAYER.id,
      difficulty: 'normal',
      language: 'en',
      isGuest: true,
    });
    expect(typeof stored.events[0].startedAt).toBe('string');
    expect(stored.events[1]).toMatchObject({
      type: 'match_abandoned',
      phase: GamePhase.NIGHT_START,
      round: 0,
      completed: false,
    });
  });

  it('records match_abandoned once when leaving an unfinished match', async () => {
    await advance(800);
    game.setPhase(GamePhase.DAY_DISCUSSION); flush();
    leave();
    const stored = readStored();
    expect(stored.events).toHaveLength(2);
    expect(stored.events[1]).toMatchObject({
      type: 'match_abandoned',
      phase: GamePhase.DAY_DISCUSSION,
      round: 1,
      completed: false,
    });
    expect(summarizeMatches()).toEqual({
      started: 1,
      finished: 0,
      abandoned: 1,
      completionRate: 0,
      abandonedByPhase: { [GamePhase.DAY_DISCUSSION]: 1 },
      abandonedByReason: { 'leave-game': 1 },
      averageRounds: 0,
    });
    leave();
    expect(readStored().events).toHaveLength(2);
  });

  it('records match_finished once on GAME_OVER and never as abandoned', async () => {
    await advance(800);
    engine.applyElimination.mockReturnValue({ players: game.players, winner: 'VILLAGERS' });
    game.setPhase(GamePhase.DAY_VOTING); flush();
    const vote = game.finishVote(2); flush();
    for (let i = 0; i < 12 && game.phase !== GamePhase.GAME_OVER; i += 1) await advance(200);
    await vote; await settle();
    flush(); flush();

    expect(game.phase).toBe(GamePhase.GAME_OVER);
    expect(game.winner).toBe('VILLAGERS');
    const stored = readStored();
    expect(stored.events).toHaveLength(2);
    expect(stored.events[1]).toMatchObject({
      type: 'match_finished',
      winner: 'VILLAGERS',
      rounds: 1,
      completed: true,
    });
    expect(stored.events.filter((event: { type: string }) => event.type === 'match_abandoned')).toHaveLength(0);
    expect(summarizeMatches()).toMatchObject({
      started: 1,
      finished: 1,
      abandoned: 0,
      completionRate: 1,
      averageRounds: 1,
    });

    leave();
    expect(readStored().events).toHaveLength(2);
    expect(snapshot().matches).toHaveLength(1);
  });

  it('does not throw when localStorage is unavailable during leaveGame', () => {
    const denied = new Error('storage denied');
    vi.stubGlobal('localStorage', {
      getItem: () => { throw denied; },
      setItem: () => { throw denied; },
      removeItem: () => { throw denied; },
    });
    expect(() => leave()).not.toThrow();
    expect(snapshot().current).toBeNull();
    expect(snapshot().matches).toHaveLength(1);
    expect(summarizeMatches()).toMatchObject({ started: 1, finished: 0, abandoned: 1, completionRate: 0 });
  });
});

describe('page lifecycle wiring (OBS-DENOM)', () => {
  it('installs page and visibility listeners with the hook mount', () => {
    expect(pageLifecycle.count('pagehide')).toBe(1);
    expect(pageLifecycle.count('pageshow')).toBe(1);
    expect(visibilityLifecycle.count('visibilitychange')).toBe(1);
  });

  it('records pagehide abandonment with the current phase and round', async () => {
    await advance(800); // NIGHT_START → beginNight increments the round
    game.setPhase(GamePhase.DAY_DISCUSSION); flush();
    expect(game.roundCount).toBe(1);

    pageLifecycle.dispatch('pagehide');

    const stored = readStored();
    expect(stored.events).toHaveLength(2);
    expect(stored.events[1]).toMatchObject({
      type: 'match_abandoned',
      phase: GamePhase.DAY_DISCUSSION,
      round: 1,
      completed: false,
      reason: 'page-hidden',
    });
    expect(summarizeMatches()).toMatchObject({
      started: 1,
      finished: 0,
      abandoned: 1,
      completionRate: 0,
      abandonedByPhase: { [GamePhase.DAY_DISCUSSION]: 1 },
      abandonedByReason: { 'page-hidden': 1 },
    });
  });

  it('does not double-record when pagehide follows leaveGame', () => {
    leave();
    const afterLeave = readStored();
    expect(afterLeave.events).toHaveLength(2);
    expect(afterLeave.events[1]).toMatchObject({ type: 'match_abandoned', reason: 'leave-game' });

    pageLifecycle.dispatch('pagehide');
    pageLifecycle.dispatch('pageshow');
    pageLifecycle.dispatch('pagehide');

    expect(readStored().events).toHaveLength(2);
    expect(snapshot().matches).toHaveLength(1);
  });

  it('does not record an abandonment after GAME_OVER', async () => {
    engine.applyElimination.mockReturnValue({ players: game.players, winner: 'VILLAGERS' });
    game.setPhase(GamePhase.DAY_VOTING); flush();
    const vote = game.finishVote(2); flush();
    for (let i = 0; i < 12 && game.phase !== GamePhase.GAME_OVER; i += 1) await advance(200);
    await vote; await settle();
    flush(); flush();
    expect(game.phase).toBe(GamePhase.GAME_OVER);

    pageLifecycle.dispatch('pagehide');

    const stored = readStored();
    expect(stored.events.map((event: { type: string }) => event.type)).toEqual([
      'match_started',
      'match_finished',
    ]);
    expect(stored.events.filter((event: { type: string }) => event.type === 'match_abandoned')).toHaveLength(0);
  });

  it('records a hidden tab only after the grace window and ignores a transient bounce', async () => {
    // Pause the phase machine so the match state is stable while time advances.
    game.togglePause(); flush();

    fakeDocument.visibilityState = 'hidden';
    visibilityLifecycle.dispatch('visibilitychange');
    await advance(PAGE_HIDDEN_GRACE_MS - 1);
    expect(values.has(MATCH_TELEMETRY_STORAGE_KEY)).toBe(false);

    fakeDocument.visibilityState = 'visible';
    visibilityLifecycle.dispatch('visibilitychange');
    await advance(PAGE_HIDDEN_GRACE_MS * 2);
    expect(values.has(MATCH_TELEMETRY_STORAGE_KEY)).toBe(false);

    fakeDocument.visibilityState = 'hidden';
    visibilityLifecycle.dispatch('visibilitychange');
    await advance(PAGE_HIDDEN_GRACE_MS);

    const stored = readStored();
    expect(stored.events).toHaveLength(2);
    expect(stored.events[1]).toMatchObject({
      type: 'match_abandoned',
      reason: 'page-hidden',
      phase: game.phase,
      round: game.roundCount,
    });
  });

  it('removes the page-lifecycle listeners on unmount and then records nothing', () => {
    expect(pageLifecycle.count('pagehide')).toBeGreaterThan(0);

    for (const effect of hooks.effects.values()) effect.cleanup?.();

    expect(pageLifecycle.count('pagehide')).toBe(0);
    expect(pageLifecycle.count('pageshow')).toBe(0);
    expect(visibilityLifecycle.count('visibilitychange')).toBe(0);

    pageLifecycle.dispatch('pagehide');
    expect(values.has(MATCH_TELEMETRY_STORAGE_KEY)).toBe(false);
  });
});
