import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE_9_PLAYER } from '../constants';
import { GamePhase, Role, type GameConfig, type GameRecord } from '../types';

const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  dirty: true,
  effects: new Map<number, { deps?: readonly unknown[]; cleanup?: () => void }>(),
  pending: [] as (() => void)[],
}));

vi.mock('../services/roleDeal', () => ({ shuffleRoles: <T,>(roles: readonly T[]) => [...roles] }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) {
        hooks.values[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      return [hooks.values[index] as T, (next: T | ((previous: T) => T)) => {
        const previous = hooks.values[index] as T;
        const value = typeof next === 'function' ? (next as (value: T) => T)(previous) : next;
        if (!Object.is(previous, value)) {
          hooks.values[index] = value;
          hooks.dirty = true;
        }
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
      if (
        previous
        && deps
        && previous.deps?.length === deps.length
        && deps.every((v, i) => Object.is(v, previous.deps?.[i]))
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

const ai = vi.hoisted(() => ({
  generateAIAction: vi.fn(),
  generateAIDialogue: vi.fn(),
  generateWolfChat: vi.fn(),
  resetAIMemory: vi.fn(),
  setAIDifficulty: vi.fn(),
}));
vi.mock('../ai/aiOrchestrator', () => ai);

const audio = vi.hoisted(() => ({
  cancel: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  reset: vi.fn(),
  setMuted: vi.fn(),
  setVolume: vi.fn(),
  setRate: vi.fn(),
  setEnabled: vi.fn(),
  enqueue: vi.fn(),
  speechLangTag: vi.fn(() => 'en-US'),
}));
vi.mock('../services/speechAudio', () => audio);

const service = vi.hoisted(() => ({
  isSupabaseConfigured: vi.fn(() => false),
  saveGameRecord: vi.fn(),
  fetchGameRecords: vi.fn(),
}));
vi.mock('../services/supabaseClient', () => service);

import { useGameState, type AuthContext } from './useGameState';

let game: ReturnType<typeof useGameState>;
let auth: AuthContext;

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
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    flush();
  }
};

const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
};

const makeBoard = (humanRole: Role): GameConfig => {
  const base: Role[] = [
    Role.VILLAGER,
    Role.WEREWOLF,
    Role.SEER,
    Role.WITCH,
    Role.VILLAGER,
    Role.HUNTER,
    Role.WEREWOLF,
    Role.VILLAGER,
    Role.WEREWOLF,
  ];
  const swapIndex = base.indexOf(humanRole);
  if (swapIndex > 0) {
    base[swapIndex] = base[0];
    base[0] = humanRole;
  }
  return { ...MODE_9_PLAYER, roles: base };
};

describe('useGameState role showcase & human skill cue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hooks.values = [];
    hooks.cursor = 0;
    hooks.dirty = true;
    hooks.effects.clear();
    hooks.pending = [];
    vi.clearAllMocks();
    vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval, location: { port: '4175' } });
    const storageValues = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => storageValues.set(key, value),
      removeItem: (key: string) => storageValues.delete(key),
    });
    ai.generateAIAction.mockResolvedValue({ targetId: 5 });
    ai.generateAIDialogue.mockResolvedValue({ en: 'Let us think carefully.', zh: '' });
    ai.generateWolfChat.mockResolvedValue([]);
    audio.enqueue.mockResolvedValue(undefined);
    auth = {
      session: null,
      isGuest: true,
      profile: null,
      records: [] as GameRecord[],
      setRecords: vi.fn(),
      recordError: '',
      setRecordError: vi.fn(),
      authEmail: '',
      guestPrincipalId: 'guest-1',
      publicName: 'Tester',
    };
    flush();
  });

  afterEach(() => {
    for (const entry of hooks.effects.values()) entry.cleanup?.();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('guards releaseIntro per matchGeneration so repeated calls only release once per match', async () => {
    game.startGame(makeBoard(Role.WITCH), 'en', { holdForIntro: true });
    flush();
    expect(game.introPending).toBe(true);

    game.releaseIntro();
    flush();
    expect(game.introPending).toBe(false);

    // Calling releaseIntro again in the same match generation is a safe no-op.
    game.releaseIntro();
    flush();
    expect(game.introPending).toBe(false);

    // Starting a fresh match resets the generation guard.
    game.startGame(makeBoard(Role.SEER), 'en', { holdForIntro: true });
    flush();
    expect(game.introPending).toBe(true);
    game.releaseIntro();
    flush();
    expect(game.introPending).toBe(false);
  });

  it('emits SEER_CHECK only on accepted Seer check without delaying phase advance, and resets on leave/start', async () => {
    game.startGame(makeBoard(Role.SEER), 'en');
    flush();
    expect(game.humanSkillCue).toBeNull();

    game.setPhase(GamePhase.NIGHT_SEER);
    flush();

    // Rejected target (human self = 1) must NOT emit a cue.
    game.handlePlayerAction(1);
    flush();
    expect(game.humanSkillCue).toBeNull();
    expect(game.phase).toBe(GamePhase.NIGHT_SEER);

    // Accepted target advances immediately and emits SEER_CHECK.
    const target = game.players.find(player => player.id !== 1)!;
    game.handlePlayerAction(target.id);
    flush();
    expect(game.phase).toBe(GamePhase.NIGHT_WITCH);
    expect(game.humanSkillCue).toMatchObject({
      kind: 'SEER_CHECK',
      actorId: 1,
      targetId: target.id,
    });

    // Dismissing with a mismatched id leaves the cue; matching id or omit clears it.
    game.dismissHumanSkillCue('wrong-id');
    flush();
    expect(game.humanSkillCue).not.toBeNull();
    game.dismissHumanSkillCue(game.humanSkillCue!.id);
    flush();
    expect(game.humanSkillCue).toBeNull();

    // Re-emit then reset via leaveGame & startGame.
    game.setPhase(GamePhase.NIGHT_SEER);
    flush();
    game.handlePlayerAction(target.id);
    flush();
    expect(game.humanSkillCue).not.toBeNull();
    game.leaveGame();
    flush();
    expect(game.humanSkillCue).toBeNull();

    game.startGame(makeBoard(Role.SEER), 'en');
    flush();
    expect(game.humanSkillCue).toBeNull();
  });

  it('emits WITCH_SAVE, WITCH_POISON, and WITCH_HOLD only on accepted human Witch actions', async () => {
    game.startGame(makeBoard(Role.WITCH), 'en');
    flush();
    await advance(700); // NIGHT_START -> NIGHT_WEREWOLVES
    await advance(700); // AI wolf kills targetId 5 -> NIGHT_SEER
    await advance(700); // AI seer -> NIGHT_WITCH
    expect(game.phase).toBe(GamePhase.NIGHT_WITCH);

    // Save accepted -> immediately advances to DAY_ANNOUNCE and emits WITCH_SAVE.
    game.handleWitchSave();
    flush();
    expect(game.phase).toBe(GamePhase.DAY_ANNOUNCE);
    expect(game.humanSkillCue).toMatchObject({
      kind: 'WITCH_SAVE',
      actorId: 1,
      targetId: 5,
    });

    // Poison when back in NIGHT_WITCH.
    game.setPhase(GamePhase.NIGHT_WITCH);
    flush();
    game.handlePlayerAction(2);
    flush();
    expect(game.phase).toBe(GamePhase.DAY_ANNOUNCE);
    expect(game.humanSkillCue).toMatchObject({
      kind: 'WITCH_POISON',
      actorId: 1,
      targetId: 2,
    });

    // Rejected poison after potion exhausted must NOT overwrite or emit a new cue.
    const previousCueId = game.humanSkillCue!.id;
    game.setPhase(GamePhase.NIGHT_WITCH);
    flush();
    game.handlePlayerAction(3);
    flush();
    expect(game.phase).toBe(GamePhase.NIGHT_WITCH);
    expect(game.humanSkillCue?.id).toBe(previousCueId);

    // Skip Witch -> emits WITCH_HOLD and advances immediately.
    game.skipWitch();
    flush();
    expect(game.phase).toBe(GamePhase.DAY_ANNOUNCE);
    expect(game.humanSkillCue).toMatchObject({
      kind: 'WITCH_HOLD',
      actorId: 1,
      targetId: null,
    });
  });

  it('emits WOLF_KILL_CONFIRM only on accepted human Werewolf kill confirmation', async () => {
    game.startGame(makeBoard(Role.WEREWOLF), 'en');
    flush();
    await advance(700); // NIGHT_START -> NIGHT_WEREWOLVES
    expect(game.phase).toBe(GamePhase.NIGHT_WEREWOLVES);

    const teammateWolf = game.players.find(p => p.id !== 1 && p.role === Role.WEREWOLF)!;
    const villagerTarget = game.players.find(p => p.role !== Role.WEREWOLF)!;

    game.handlePlayerAction(99);
    flush();
    expect(game.humanSkillCue).toBeNull();

    game.handlePlayerAction(teammateWolf.id);
    flush();
    expect(game.humanSkillCue).toMatchObject({
      kind: 'WOLF_KILL_CONFIRM', actorId: 1, targetId: teammateWolf.id,
    });
    const confirmedCue = game.humanSkillCue;
    game.handlePlayerAction(villagerTarget.id);
    flush();
    expect(game.humanSkillCue).toBe(confirmedCue);
  });
});
