import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GamePhase, Role, type GameConfig, type GameRecord } from '../types';
import { MODE_9_PLAYER, MODE_12_PLAYER } from '../constants';
import { getTerminalRewardRequest } from '../economy/gameRewards';
import * as aiStyles from '../services/aiStyles';
import * as replay from '../replay';
import { globalBeliefTracker } from '../ai/beliefTracker';
import { selectAction } from '../ai/actionSelector';

// A dependency-aware hook runner: executes the real hook, effects, timer
// callbacks and async continuations without requiring an installed DOM library.
const hooks = vi.hoisted(() => ({
  values: [] as unknown[], cursor: 0, dirty: true,
  effects: new Map<number, { deps?: readonly unknown[]; cleanup?: () => void }>(),
  pending: [] as (() => void)[],
}));
// These scenarios script each seat's role, so the deal is pinned to the
// board's configured order instead of a random shuffle.
vi.mock('../services/roleDeal', () => ({ shuffleRoles: <T,>(roles: readonly T[]) => [...roles] }));
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
const ai = vi.hoisted(() => ({ generateAIAction: vi.fn(), generateAIDialogue: vi.fn(), generateWolfChat: vi.fn(), resetAIMemory: vi.fn(), setAIDifficulty: vi.fn() }));
vi.mock('../ai/aiOrchestrator', () => ai);
const audio = vi.hoisted(() => ({ cancel: vi.fn(), pause: vi.fn(), resume: vi.fn(), reset: vi.fn(), setMuted: vi.fn(), setVolume: vi.fn(), setRate: vi.fn(), setEnabled: vi.fn(), enqueue: vi.fn(), speechLangTag: vi.fn(() => 'en-US') }));
vi.mock('../services/speechAudio', () => audio);
const service = vi.hoisted(() => ({ isSupabaseConfigured: vi.fn(() => true), saveGameRecord: vi.fn(), fetchGameRecords: vi.fn() }));
vi.mock('../services/supabaseClient', () => service);

import { useGameState, type AuthContext } from './useGameState';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const fixture: GameConfig = { ...MODE_9_PLAYER, roles: [Role.VILLAGER, Role.WEREWOLF, Role.SEER, Role.WITCH, Role.VILLAGER, Role.HUNTER, Role.WEREWOLF, Role.VILLAGER, Role.WEREWOLF] };
let game: ReturnType<typeof useGameState>;
let auth: AuthContext;
const flush = () => {
  for (let i = 0; hooks.dirty; i++) {
    if (i > 40) throw new Error('Hook render did not settle');
    hooks.dirty = false; hooks.cursor = 0;
    game = useGameState(auth);
    for (const effect of hooks.pending.splice(0)) effect();
  }
};
const settle = async () => { for (let i = 0; i < 40; i++) { await Promise.resolve(); flush(); } };
const advance = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); await settle(); };
const start = (config = fixture) => { game.startGame(config, 'en'); flush(); };
const snapshot = () => JSON.stringify({ config:game.config,players:game.players,phase:game.phase,logs:game.logs,round:game.roundCount,winner:game.winner,votes:game.voteRecords,night:game.nightState,witch:game.witchStatus,wolfChat:game.wolfChat,seer:game.aiSeerLastCheck,speaker:game.currentSpeaker,processing:game.isProcessingAI,saved:game.savedRecordId,records:auth.records });
const leave = () => { game.leaveGame(); flush(); };
const togglePause = () => { game.togglePause(); flush(); };
const enterAIStatement = async () => {
  game.setPhase(GamePhase.DAY_HUNTER_CHECK); flush(); await advance(700);
  await advance(700); // First speaker is the human in this deterministic fixture.
  expect(game.currentSpeaker?.id).toBe(1);
  game.setUserInput('I will listen to the other players before voting.'); flush();
  game.handleHumanSpeechSubmit(); flush(); await advance(700);
  expect(ai.generateAIDialogue).toHaveBeenCalledOnce();
};

beforeEach(() => {
  vi.useFakeTimers();
  hooks.values = []; hooks.cursor = 0; hooks.dirty = true; hooks.effects.clear(); hooks.pending = [];
  vi.stubGlobal('window', { setTimeout, clearTimeout, setInterval, clearInterval, location: { port: '4175' } });
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  Object.values(ai).forEach(mock => mock.mockReset());
  Object.values(audio).forEach(mock => mock.mockClear());
  audio.enqueue.mockReset().mockResolvedValue(undefined);
  ai.generateAIAction.mockResolvedValue({ targetId: null });
  ai.generateAIDialogue.mockResolvedValue({ en: 'A complete local fixture statement.', zh: '本地测试发言。' });
  ai.generateWolfChat.mockResolvedValue([]);
  service.saveGameRecord.mockReset();
  auth = {
    session:null,isGuest:true,profile:null,records:[],recordError:'',authEmail:'',
    guestPrincipalId:'guest:11111111-1111-4111-8111-111111111111',publicName:'Guest Fixture',
    setRecords:vi.fn(next => { auth.records = typeof next === 'function' ? next(auth.records) : next; hooks.dirty = true; }),
    setRecordError:vi.fn(next => { auth.recordError = typeof next === 'function' ? next(auth.recordError) : next; }),
  };
  flush(); start();
});
afterEach(() => {
  for (const effect of hooks.effects.values()) effect.cleanup?.();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('match lifetime isolation', () => {
  it('cancels a vote delay immediately, keeps Lobby, and makes repeated leave idempotent', async () => {
    game.setPhase(GamePhase.DAY_VOTING); flush();
    const work = game.finishVote(null); flush();
    expect(game.isProcessingAI).toBe(true);
    leave(); const expected = snapshot(); const cancelled = audio.cancel.mock.calls.length;
    game.leaveGame(); flush();
    expect(audio.cancel).toHaveBeenCalledTimes(cancelled);
    await work; await advance(5000);
    expect(snapshot()).toBe(expected);
    expect(game.phase).toBe(GamePhase.LOBBY);
    expect(game.isProcessingAI).toBe(false);
    expect(ai.generateAIAction).not.toHaveBeenCalled();
    expect(auth.setRecords).not.toHaveBeenCalled();
  });

  it.each(['resolve','reject'] as const)('discards an in-flight vote %s, including stale error/finally commits', async outcome => {
    const old = deferred<{ targetId: number }>(); ai.generateAIAction.mockReturnValueOnce(old.promise);
    game.setPhase(GamePhase.DAY_VOTING); flush(); const work = game.finishVote(null); flush(); await advance(180);
    expect(ai.generateAIAction).toHaveBeenCalledOnce();
    leave(); const expected = snapshot();
    if (outcome === 'resolve') old.resolve({ targetId:2 }); else old.reject(new Error('old vote failed'));
    await work; await settle();
    expect(snapshot()).toBe(expected); expect(auth.setRecords).not.toHaveBeenCalled();
  });

  it('does not let an old finalizer clear a new match processing flag', async () => {
    const old = deferred<{ targetId: number }>(), current = deferred<{ targetId: number }>();
    ai.generateAIAction.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    game.setPhase(GamePhase.NIGHT_SEER); flush(); await advance(700);
    expect(game.isProcessingAI).toBe(true);
    leave(); start(MODE_12_PLAYER);
    game.setPhase(GamePhase.NIGHT_SEER); flush(); await advance(700);
    expect(game.isProcessingAI).toBe(true); const expected=snapshot();
    old.resolve({targetId:1}); await settle();
    expect(snapshot()).toBe(expected); expect(game.isProcessingAI).toBe(true);
    current.resolve({targetId:2}); await settle();
    expect(game.phase).toBe(GamePhase.NIGHT_WITCH); expect(game.isProcessingAI).toBe(false);
  });

  it('starting another match directly invalidates the preceding match work', async () => {
    const old=deferred<{targetId:number}>();ai.generateAIAction.mockReturnValueOnce(old.promise);
    game.setPhase(GamePhase.NIGHT_SEER);flush();await advance(700);
    start(MODE_12_PLAYER);const expected=snapshot();old.resolve({targetId:2});await settle();
    expect(snapshot()).toBe(expected);expect(game.config?.id).toBe('12-standard');
  });

  it.each([GamePhase.NIGHT_WEREWOLVES,GamePhase.NIGHT_SEER,GamePhase.NIGHT_WITCH])('ignores %s AI completion after leave', async phase => {
    const work=deferred<{targetId:number}>(); ai.generateAIAction.mockReturnValue(work.promise);
    if (phase === GamePhase.NIGHT_WITCH) vi.mocked(Math.random).mockReturnValue(0.9);
    game.setPhase(phase); flush(); await advance(700);
    expect(ai.generateAIAction).toHaveBeenCalled();
    leave(); const expected=snapshot();work.resolve({targetId:2}); await settle();
    expect(snapshot()).toBe(expected);
  });

  it('discards wolf-chat completion before it can launch an old night action', async () => {
    const work=deferred<[]>(); ai.generateWolfChat.mockReturnValue(work.promise);
    game.setPhase(GamePhase.NIGHT_WEREWOLVES); flush(); await advance(700);
    leave(); const expected=snapshot(); work.resolve([]); await settle();
    expect(snapshot()).toBe(expected); expect(ai.generateAIAction).not.toHaveBeenCalled();
  });

  it('discards late dialogue without logs or queued audio', async () => {
    const work=deferred<{en:string;zh:string}>();ai.generateAIDialogue.mockReturnValue(work.promise);
    await enterAIStatement(); leave(); const expected=snapshot();
    work.resolve({en:'Old game text.',zh:'旧局发言。'});await settle();
    expect(snapshot()).toBe(expected);expect(audio.enqueue).not.toHaveBeenCalled();
  });

  it.each(['resolve','reject'] as const)('ignores old TTS %s after a new game has its own speaker', async outcome => {
    const work=deferred<void>();audio.enqueue.mockReturnValueOnce(work.promise);
    await enterAIStatement();expect(audio.enqueue).toHaveBeenCalledOnce();
    leave();start();game.setPhase(GamePhase.DAY_HUNTER_CHECK);flush();await advance(1400);
    // A second 700ms interval is needed after the first phase commit.
    if (!game.currentSpeaker) await advance(700);
    expect(game.currentSpeaker?.id).toBe(1);const expected=snapshot();
    if(outcome==='resolve')work.resolve();else work.reject(new Error('old audio cancelled'));
    await settle();expect(snapshot()).toBe(expected);
  });

  it('ordinary rerenders during a cancellation dialog leave the current async work valid', async () => {
    const work=deferred<{targetId:number}>();ai.generateAIAction.mockReturnValueOnce(work.promise);
    game.setPhase(GamePhase.NIGHT_SEER);flush();await advance(700);
    const expected=snapshot(), cancelled=audio.cancel.mock.calls.length;
    // Dialog state lives in App: opening and each dismissal only rerender this hook.
    for(let i=0;i<4;i++){hooks.dirty=true;flush();expect(snapshot()).toBe(expected);}
    expect(audio.cancel).toHaveBeenCalledTimes(cancelled);
    work.resolve({targetId:2});await settle();
    expect(game.aiSeerLastCheck?.targetId).toBe(2);expect(game.phase).toBe(GamePhase.NIGHT_WITCH);
  });

  it('invalidates outstanding work on unmount', async () => {
    const work=deferred<{targetId:number}>();ai.generateAIAction.mockReturnValueOnce(work.promise);
    game.setPhase(GamePhase.NIGHT_SEER);flush();await advance(700);
    for(const effect of hooks.effects.values())effect.cleanup?.();
    const values=[...hooks.values];work.resolve({targetId:1});await Promise.resolve();await Promise.resolve();await Promise.resolve();
    expect(hooks.values).toEqual(values);
  });
});

describe('pause and resume', () => {
  it.each([MODE_9_PLAYER, MODE_12_PLAYER])('restarts the automatic phase delay once on $id', async config => {
    start(config);
    await advance(699);
    togglePause();
    const before = snapshot();
    // Rapid toggles without rendering still use the latest pause state.
    game.togglePause();
    game.togglePause();
    flush();
    await advance(61_000);
    expect(game.isPaused).toBe(true);
    expect(snapshot()).toBe(before);
    expect(ai.generateWolfChat).not.toHaveBeenCalled();
    togglePause();
    await advance(699);
    expect(snapshot()).toBe(before);
    await advance(1);
    expect(game.phase).toBe(GamePhase.NIGHT_WEREWOLVES);
    expect(game.roundCount).toBe(1);
  });

  it.each([
    [GamePhase.NIGHT_WEREWOLVES, GamePhase.NIGHT_SEER],
    [GamePhase.NIGHT_SEER, GamePhase.NIGHT_WITCH],
    [GamePhase.NIGHT_WITCH, GamePhase.DAY_ANNOUNCE],
    [GamePhase.DAY_ANNOUNCE, GamePhase.DAY_HUNTER_CHECK],
    [GamePhase.DAY_HUNTER_CHECK, GamePhase.DAY_DISCUSSION],
  ])('holds the automatic %s branch until resume', async (phase, nextPhase) => {
    game.setPhase(phase); flush();
    togglePause();
    const before = snapshot();
    await advance(2500);
    expect(snapshot()).toBe(before);
    expect(ai.generateAIAction).not.toHaveBeenCalled();
    expect(ai.generateWolfChat).not.toHaveBeenCalled();
    togglePause();
    await advance(700);
    expect(game.phase).toBe(nextPhase);
  });

  it('holds an AI role error and its phase advance until resumed', async () => {
    const held = deferred<{ targetId: number }>();
    ai.generateAIAction.mockReturnValueOnce(held.promise);
    game.setPhase(GamePhase.NIGHT_SEER); flush(); await advance(700);
    togglePause();
    const before = snapshot();
    held.reject(new Error('fixture role error'));
    await advance(2500);
    expect(snapshot()).toBe(before);
    togglePause();
    await settle();
    expect(game.phase).toBe(GamePhase.NIGHT_WITCH);
    expect(game.logs.filter(log => log.message === 'AI error. Seer check skipped.')).toHaveLength(1);
  });

  it.each(['resolve', 'reject'] as const)('defers an in-flight speech %s through pause and consumes it once', async outcome => {
    const work = deferred<{ en: string; zh: string }>();
    const commit = vi.fn();
    ai.generateAIDialogue.mockImplementationOnce((...args) => {
      args[10].deferCommit(commit);
      return work.promise;
    });
    await enterAIStatement();
    togglePause();
    const before = snapshot();
    if (outcome === 'resolve') work.resolve({ en: 'A held fixture statement.', zh: '' });
    else work.reject(new Error('fixture AI failure'));
    await settle();
    await advance(61_000);
    expect(snapshot()).toBe(before);
    expect(commit).not.toHaveBeenCalled();
    expect(audio.enqueue).not.toHaveBeenCalled();
    expect(ai.generateAIDialogue).toHaveBeenCalledOnce();
    togglePause();
    await settle();
    expect(game.logs.filter(log => outcome === 'resolve'
      ? log.message === 'A held fixture statement.' : log.message.includes('speech skipped (AI error)'))).toHaveLength(1);
    expect(commit).toHaveBeenCalledTimes(outcome === 'resolve' ? 1 : 0);
    await advance(700);
    expect(ai.generateAIDialogue.mock.calls.map(([speaker]) => speaker.id)).toEqual([2, 3]);
  });

  it('pauses displayed TTS and waits for the same utterance to finish', async () => {
    const work = deferred<void>();
    audio.enqueue.mockReturnValueOnce(work.promise);
    await enterAIStatement();
    const before = snapshot();
    expect(game.logs.at(-1)?.speakerId).toBe(2);
    const cancelsBeforePause = audio.cancel.mock.calls.length;
    togglePause();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.cancel).toHaveBeenCalledTimes(cancelsBeforePause);
    await advance(10_000);
    expect(snapshot()).toBe(before);
    game.skipCurrentSpeech();
    expect(audio.enqueue).toHaveBeenCalledOnce();
    expect(ai.generateAIDialogue).toHaveBeenCalledOnce();
    togglePause();
    await settle();
    expect(audio.resume).toHaveBeenCalledOnce();
    expect(game.currentSpeaker?.id).toBe(2);
    work.resolve();
    await settle();
    expect(game.currentSpeaker).toBeNull();
    expect(audio.enqueue).toHaveBeenCalledOnce();
    await advance(700);
    expect(ai.generateAIDialogue.mock.calls.map(([speaker]) => speaker.id)).toEqual([2, 3]);
    expect(game.logs.filter(log => log.speakerId === 2)).toHaveLength(1);
  });

  it('freezes the last fractional second of a human speech and keeps the draft', async () => {
    game.setPhase(GamePhase.DAY_HUNTER_CHECK); flush();
    await advance(700);
    await advance(700);
    expect(game.speechTimer).toBe(60);
    game.setUserInput('A draft to read later.'); flush();
    await advance(59_875);
    togglePause();
    game.handleHumanSpeechSubmit(); flush();
    await advance(61_000);
    expect(game.userInput).toBe('A draft to read later.');
    expect(game.currentSpeaker?.id).toBe(1);
    expect(game.speechTimer).toBe(1);
    togglePause();
    await advance(124);
    expect(game.currentSpeaker?.id).toBe(1);
    await advance(1);
    game.handleHumanSpeechSubmit(); flush();
    expect(game.logs.filter(log => log.message === 'Time expired. Speech skipped.')).toHaveLength(1);
    expect(game.logs.some(log => log.speakerId === 1)).toBe(false);
  });

  it('freezes the vote deadline and lets expiry and repeated clicks claim at most one vote', async () => {
    game.setPhase(GamePhase.DAY_VOTING); flush();
    await advance(9_875);
    togglePause();
    void game.finishVote(2);
    await advance(61_000);
    expect(game.voteTimer).toBe(1);
    expect(ai.generateAIAction).not.toHaveBeenCalled();
    togglePause();
    await advance(124);
    expect(game.voteTimer).toBe(1);
    await advance(1);
    void game.finishVote(2);
    void game.finishVote(3);
    await advance(8 * 180);
    expect(ai.generateAIAction).toHaveBeenCalledTimes(8);
    expect(game.logs.filter(log => log.message.startsWith('Vote record:'))).toHaveLength(1);
    expect(game.voteRecords).toHaveLength(9);
    expect(game.voteRecords.find(vote => vote.voterId === 1)?.targetId).toBeNull();
  });

  it('holds a deadline already reached when its timer callback has not run', async () => {
    game.setPhase(GamePhase.DAY_VOTING); flush();
    vi.setSystemTime(Date.now() + 10_000);
    togglePause();
    expect(game.voteTimer).toBe(0);
    await advance(61_000);
    expect(game.phase).toBe(GamePhase.DAY_VOTING);
    expect(ai.generateAIAction).not.toHaveBeenCalled();
    togglePause();
    await advance(1 + 8 * 180);
    expect(game.voteRecords).toHaveLength(9);
    expect(game.logs.filter(log => log.message.startsWith('Vote record:'))).toHaveLength(1);
  });

  it('defers the next AI vote and tally while a previous vote resolves during pause', async () => {
    const held = deferred<{ targetId: number | null }>();
    ai.generateAIAction.mockReturnValueOnce(held.promise);
    game.setPhase(GamePhase.DAY_VOTING); flush();
    const voting = game.finishVote(2); flush();
    await advance(180);
    togglePause();
    const before = snapshot();
    held.resolve({ targetId: 2 });
    await advance(61_000);
    expect(snapshot()).toBe(before);
    expect(ai.generateAIAction).toHaveBeenCalledOnce();
    togglePause();
    await settle();
    await advance(179);
    expect(ai.generateAIAction).toHaveBeenCalledOnce();
    await advance(1);
    expect(ai.generateAIAction).toHaveBeenCalledTimes(2);
    await advance(6 * 180);
    await voting;
    expect(game.voteRecords.filter(vote => vote.targetId === 2).map(vote => vote.voterId)).toEqual([1, 2]);
    expect(game.phase).toBe(GamePhase.NIGHT_START);
  });

  const wolfFixture = { ...fixture, roles: [Role.WEREWOLF, Role.VILLAGER, ...fixture.roles.slice(2)] };

  it('freezes the wolf clock and never repeats an empty wolf-chat result', async () => {
    start(wolfFixture);
    game.setPhase(GamePhase.NIGHT_WEREWOLVES); flush();
    await advance(119_875);
    expect(ai.generateWolfChat).toHaveBeenCalledTimes(2);
    togglePause();
    game.handlePlayerAction(2); flush();
    await advance(61_000);
    expect(game.wolfCountdown).toBe(1);
    expect(game.nightState.wolfKillId).toBeNull();
    togglePause();
    await advance(124);
    expect(game.phase).toBe(GamePhase.NIGHT_WEREWOLVES);
    await advance(1);
    expect(game.phase).toBe(GamePhase.NIGHT_SEER);
    expect(game.nightState.wolfKillId).toBe(5);
    expect(ai.generateWolfChat).toHaveBeenCalledTimes(2);
  });

  it('keeps early human-wolf targeting and discards a late chat for the old phase', async () => {
    start(wolfFixture);
    const held = deferred<[]>();
    const commit = vi.fn();
    ai.generateWolfChat.mockImplementationOnce((...args) => {
      args[6].deferCommit(commit);
      return held.promise;
    });
    game.setPhase(GamePhase.NIGHT_WEREWOLVES); flush(); await advance(15_000);
    game.handlePlayerAction(2); flush();
    expect(game.phase).toBe(GamePhase.NIGHT_WEREWOLVES);
    expect(game.nightState.wolfKillId).toBe(2);
    game.skipWolfChat(); flush();
    expect(game.phase).toBe(GamePhase.NIGHT_SEER);
    held.resolve([]);
    await settle();
    expect(game.wolfChat).toEqual([]);
    expect(commit).not.toHaveBeenCalled();
    expect(ai.generateWolfChat).toHaveBeenCalledTimes(2);
  });

  it('drops an old paused result and lets a fresh match start running', async () => {
    const work = deferred<{ en: string; zh: string }>();
    ai.generateAIDialogue.mockReturnValueOnce(work.promise);
    await enterAIStatement();
    togglePause();
    work.resolve({ en: 'Old paused text.', zh: '' });
    await settle();
    leave();
    start(MODE_12_PLAYER);
    await settle();
    expect(game.isPaused).toBe(false);
    expect(game.logs.some(log => log.message === 'Old paused text.')).toBe(false);
    expect(audio.enqueue).not.toHaveBeenCalled();
    await advance(700);
    expect(game.phase).toBe(GamePhase.NIGHT_WEREWOLVES);
  });
});

const winningFixture: GameConfig = { ...fixture, playerCount:3,roles:[Role.VILLAGER,Role.WEREWOLF,Role.VILLAGER] };
const completeWinningVote = async () => {
  start(winningFixture);ai.generateAIAction.mockResolvedValue({targetId:2});
  game.setPhase(GamePhase.DAY_VOTING);flush();const work=game.finishVote(2);flush();await advance(360);await work;await settle();
};
describe('current and stale terminal records', () => {
  it('accepts a current authenticated terminal save exactly once', async () => {
    auth.session={accessToken:'fixture',refreshToken:'fixture',user:{id:'account-fixture',email:'fixture@example.test'}};auth.isGuest=false;
    const save=deferred<GameRecord>();service.saveGameRecord.mockReturnValueOnce(save.promise);
    await completeWinningVote();expect(service.saveGameRecord).toHaveBeenCalledOnce();
    save.resolve({id:'current-record',userId:'account-fixture',boardId:'9-standard',role:Role.VILLAGER,result:'WIN',rounds:1,summary:'fixture',createdAt:new Date().toISOString()});
    await settle();expect(auth.setRecords).toHaveBeenCalledOnce();expect(game.savedRecordId).toBe('current-record');
    hooks.dirty=true;flush();expect(service.saveGameRecord).toHaveBeenCalledOnce();
    expect(game.phase).toBe(GamePhase.GAME_OVER);expect(game.winner).toBe('VILLAGERS');
  });
  it('keeps a guest winner and transient reward ID without saving match history', async () => {
    await completeWinningVote();
    expect(game.phase).toBe(GamePhase.GAME_OVER);expect(game.winner).toBe('VILLAGERS');
    expect(auth.setRecords).not.toHaveBeenCalled();expect(auth.records).toHaveLength(0);expect(service.saveGameRecord).not.toHaveBeenCalled();
    const request=()=>getTerminalRewardRequest({phase:game.phase,winner:game.winner,savedRecordId:game.savedRecordId,role:game.me?.role??null,hasConfig:!!game.config});
    const first=request();expect(first).toEqual({gameId:game.savedRecordId,won:true});
    hooks.dirty=true;flush();await advance(3000);
    expect(request()).toEqual(first);expect(auth.setRecords).not.toHaveBeenCalled();
    leave();expect(request()).toBeNull();expect(auth.records).toHaveLength(0);
  });

  it('does not create a stale winner, record or reward when a winning vote resolves after exit', async () => {
    start(winningFixture);const old=deferred<{targetId:number}>();ai.generateAIAction.mockReturnValueOnce(old.promise);
    game.setPhase(GamePhase.DAY_VOTING);flush();const work=game.finishVote(2);flush();await advance(180);
    leave();old.resolve({targetId:2});await work;await settle();
    expect(game.winner).toBeNull();expect(game.savedRecordId).toBeNull();expect(auth.setRecords).not.toHaveBeenCalled();expect(service.saveGameRecord).not.toHaveBeenCalled();
  });

  it.each(['resolve','reject'] as const)('discards an old account save %s and never duplicates an in-flight save', async outcome => {
    auth.session={accessToken:'fixture',refreshToken:'fixture',user:{id:'account-fixture',email:'fixture@example.test'}};auth.isGuest=false;
    const old=deferred<GameRecord>();service.saveGameRecord.mockReturnValueOnce(old.promise);
    await completeWinningVote();expect(service.saveGameRecord).toHaveBeenCalledOnce();
    auth.records=[...auth.records];hooks.dirty=true;flush();expect(service.saveGameRecord).toHaveBeenCalledOnce();
    leave();start();const expected=snapshot();const errors=vi.mocked(auth.setRecordError).mock.calls.length;
    if(outcome==='resolve')old.resolve({id:'old-record',userId:'account-fixture',boardId:'9-standard',role:Role.VILLAGER,result:'WIN',rounds:1,summary:'fixture',createdAt:new Date().toISOString()});
    else old.reject(new Error('old save failed'));
    await settle();expect(snapshot()).toBe(expected);expect(auth.setRecords).not.toHaveBeenCalled();expect(auth.setRecordError).toHaveBeenCalledTimes(errors);
  });
});


describe('new-match language selection', () => {
  it.each([true, false])('uses English for a fresh player (guest=%s) in both generation paths', async isGuest => {
    leave();
    auth.isGuest = isGuest;
    if (!isGuest) auth.session = { user: { id: 'new-account' } } as AuthContext['session'];
    game.startGame(fixture); flush();
    expect(game.gameLanguage).toBe('en');
    game.setPhase(GamePhase.NIGHT_WEREWOLVES); flush(); await advance(700);
    expect(ai.generateWolfChat.mock.calls[0][5]).toBe('en');
    await enterAIStatement();
    expect(ai.generateAIDialogue.mock.calls[0][9]).toBe('en');
  });

  it('captures explicit Chinese for both generation paths until the next game', async () => {
    leave(); game.startGame(fixture, 'zh'); flush();
    expect(game.gameLanguage).toBe('zh');
    game.setPhase(GamePhase.NIGHT_WEREWOLVES); flush(); await advance(700);
    expect(ai.generateWolfChat.mock.calls[0][5]).toBe('zh');
    await enterAIStatement();
    expect(ai.generateAIDialogue.mock.calls[0][9]).toBe('zh');
    leave(); game.startGame(fixture, 'en'); flush();
    expect(game.gameLanguage).toBe('en');
  });
});

describe('new-match public speech personas', () => {
  it.each([MODE_9_PLAYER, MODE_12_PLAYER])('assigns one persona to each AI on $id', async config => {
    leave();
    const pickPersona = vi.spyOn(aiStyles, 'pickRolePersona');
    start(config);
    expect(pickPersona).toHaveBeenCalledTimes(config.roles.length - 1);
    expect(game.players[0]).not.toHaveProperty('aiSpeechPersonaId');
    const firstIds = game.players.slice(1).map(player => player.aiSpeechPersonaId);
    expect(firstIds).toHaveLength(config.roles.length - 1);
    expect(new Set(firstIds)).toEqual(new Set(['brief-hesitant']));

    hooks.dirty = true;
    flush();
    expect(game.players.slice(1).map(player => player.aiSpeechPersonaId)).toEqual(firstIds);

    await enterAIStatement();
    expect(pickPersona).toHaveBeenCalledTimes(config.roles.length - 1);
    const [speaker, roster] = ai.generateAIDialogue.mock.calls[0];
    expect(speaker.aiSpeechPersonaId).toBe(firstIds[speaker.id - 2]);
    expect(roster.slice(1).map((player: typeof game.players[number]) => player.aiSpeechPersonaId)).toEqual(firstIds);

    leave();
    vi.mocked(Math.random).mockReturnValue(0.99);
    start(config);
    expect(pickPersona).toHaveBeenCalledTimes(2 * (config.roles.length - 1));
    expect(game.players[0]).not.toHaveProperty('aiSpeechPersonaId');
    expect(game.players.slice(1).map(player => player.aiSpeechPersonaId))
      .toEqual(firstIds.map(() => 'analysis-confident'));
  });
});


describe('human-first private wolf discussion', () => {
  const wolfFixture = { ...fixture, roles: [Role.WEREWOLF, Role.VILLAGER, ...fixture.roles.slice(2)] };
  const begin = () => { start(wolfFixture); game.setPhase(GamePhase.NIGHT_WEREWOLVES); flush(); };
  const send = (text: string) => { game.setUserInput(text); flush(); game.handleWolfChatSubmit(); flush(); };
  const entry = (speakerId: number, message = `Player ${speakerId} acknowledges the plan. I will keep our public reasoning independent.`) => ({ id: `reply-${speakerId}-${message}`, round: 1, speakerId, message, strategyTag: '补位' as const });
  const respond = () => ai.generateWolfChat.mockImplementation(async ([wolf]) => [entry(wolf.id)]);

  it('commits real night-chat instructions to the addressed wolf only for tactical voting', async () => {
    begin();
    send('7号，请自票。 3号，请自票。'); await settle();
    const vote = (seat: number) => selectAction(game.players[seat - 1], game.players, globalBeliefTracker,
      'VOTE', 1, [], 1, { rng: () => 0 });
    expect(vote(7).targetId).toBe(7);
    expect(vote(9).targetId).not.toBe(9);
    expect(vote(3).targetId).not.toBe(3);
    expect(globalBeliefTracker.getSeatMemory(3)?.visibleEvents.some(e => e.kind === 'wolf-plan')).toBe(false);
    send('7号，别自票。'); await settle();
    expect(vote(7).targetId).not.toBe(7);
  });

  it.each([
    { config: MODE_9_PLAYER, targetId: 1, save: true },
    { config: MODE_12_PLAYER, targetId: 2, save: false },
  ])('carries a locked wolf victim through Witch and dawn on $config.id (save=$save)', async ({ config, targetId, save }) => {
    start(config); await advance(700);
    const witch = game.players.find(p => p.role === Role.WITCH)!;
    if (!save) {
      globalBeliefTracker.updateFromSpeech(1, `Player ${targetId} is a wolf.`, game.players, { round: 1 });
    }
    game.handlePlayerAction(targetId); flush();
    game.handlePlayerAction(config.playerCount); flush();
    expect(game.nightState.wolfKillId).toBe(targetId);
    expect(game.logs.find(l => l.message.startsWith('Wolf target locked'))?.visibility).toBe('wolf-private');
    game.skipWolfChat(); flush();
    await advance(700); await advance(700);
    expect(game.nightState).toMatchObject({ wolfKillId: targetId, witchSaved: save });
    const info = globalBeliefTracker.getSeatMemory(witch.id)?.visibleEvents.find(e => e.kind === 'witch-info');
    expect(info?.payload).toMatchObject({ wolfKillId: targetId, saved: save });
    expect(globalBeliefTracker.getSeatMemory(config.playerCount)?.visibleEvents.some(e => e.kind === 'witch-info')).toBe(false);
    await advance(700);
    expect(game.players[targetId - 1]).toMatchObject({ isAlive: save, isRevealed: false });
  });

  it('reserves 15 seconds for the human and keeps the full 120-second window', async () => {
    begin(); respond();
    expect(game.wolfCountdown).toBe(120);
    await advance(14_999); expect(ai.generateWolfChat).not.toHaveBeenCalled();
    await advance(1); expect(ai.generateWolfChat).toHaveBeenCalledTimes(2);
    expect(game.phase).toBe(GamePhase.NIGHT_WEREWOLVES);
    expect(game.wolfCountdown).toBe(105);
    expect(game.wolfChat.map(item => item.speakerId)).toEqual([7, 9]);
    expect(game.logs.filter(log => log.tone === 'wolf' && !log.isSystem)).toHaveLength(2);
  });

  it('sends the human instruction before either teammate reasons, with sequential context', async () => {
    begin(); respond(); send('Player 7, please claim Seer. Player 9, stay under the radar.'); await settle();
    expect(game.wolfChat.map(item => item.speakerId)).toEqual([1, 7, 9]);
    expect(ai.generateWolfChat.mock.calls[0][0].map((p: { id: number }) => p.id)).toEqual([7]);
    expect(ai.generateWolfChat.mock.calls[0][7].history.map((p: { speakerId: number }) => p.speakerId)).toEqual([1]);
    expect(ai.generateWolfChat.mock.calls[1][7].history.map((p: { speakerId: number }) => p.speakerId)).toEqual([1, 7]);
    expect(game.userInput).toBe('');
    expect(game.phase).toBe(GamePhase.NIGHT_WEREWOLVES);
  });

  it('interrupts thinking and rejects late commits after a newer human instruction', async () => {
    begin(); const old = deferred<ReturnType<typeof entry>[]>(); const commit = vi.fn();
    ai.generateWolfChat.mockImplementationOnce((...args) => { args[6].deferCommit(commit); return old.promise; });
    send('Player 7, claim Seer.'); await settle();
    const signal = ai.generateWolfChat.mock.calls[0][6].signal as AbortSignal;
    respond(); send('Change of plan. Player 7, stay quiet.'); await settle();
    expect(signal.aborted).toBe(true);
    old.resolve([entry(7, 'This is the obsolete instruction. I am claiming Seer.')]); await settle();
    expect(commit).not.toHaveBeenCalled();
    expect(game.wolfChat.map(item => item.speakerId)).toEqual([1, 1, 7, 9]);
    expect(game.wolfChat.some(item => item.message.includes('obsolete'))).toBe(false);
    expect(ai.generateWolfChat.mock.calls[1][7].history.at(-1).message).toContain('Change of plan');
  });

  it('interrupts spoken audio without dropping complete messages already logged', async () => {
    begin(); respond(); const speaking = deferred<void>(); audio.enqueue.mockReturnValueOnce(speaking.promise);
    send('Player 7, lead the push.'); await settle();
    expect(game.wolfChat.map(item => item.speakerId)).toEqual([1, 7]);
    const before = audio.cancel.mock.calls.length;
    send('Player 7, stay under the radar instead.'); await settle();
    expect(audio.cancel.mock.calls.length).toBeGreaterThan(before);
    speaking.resolve(); await settle();
    expect(game.wolfChat.map(item => item.speakerId)).toEqual([1, 7, 1, 7, 9]);
    expect(game.wolfSpeakerId).toBeNull();
  });

  it('waits while a human composes and does not auto-generate over the draft', async () => {
    begin(); game.interruptWolfChat(); flush(); await advance(30_000);
    expect(ai.generateWolfChat).not.toHaveBeenCalled();
    respond(); send('I will lead tomorrow.'); await settle();
    expect(ai.generateWolfChat).toHaveBeenCalledTimes(2);
  });

  it('holds completed replies while paused and resumes exactly once', async () => {
    begin(); const held = deferred<ReturnType<typeof entry>[]>(); ai.generateWolfChat.mockReturnValueOnce(held.promise);
    send('Player 7, lead.'); await settle(); togglePause(); held.resolve([entry(7)]); await settle();
    expect(game.wolfChat.map(item => item.speakerId)).toEqual([1]);
    await advance(150_000); expect(game.wolfCountdown).toBe(120);
    respond(); togglePause(); await settle();
    expect(game.wolfChat.map(item => item.speakerId)).toEqual([1, 7, 9]);
  });

  it('cancels old replies when composing while paused, and keeps kill confirmation quiet during recording', async () => {
    begin(); const held = deferred<ReturnType<typeof entry>[]>(); ai.generateWolfChat.mockReturnValueOnce(held.promise);
    send('Player 7, lead.'); await settle();
    const signal = ai.generateWolfChat.mock.calls[0][6].signal as AbortSignal;
    togglePause(); game.interruptWolfChat(); game.setUserInput('A revised draft.'); flush();
    expect(signal.aborted).toBe(true);
    held.resolve([entry(7, 'This obsolete reply must never appear. I will lead.')]); await settle();
    togglePause(); await settle();
    game.handlePlayerAction(2); flush(); await settle();
    expect(ai.generateWolfChat).toHaveBeenCalledOnce();
    expect(game.wolfChat.map(item => item.speakerId)).toEqual([1]);
    expect(game.nightState.wolfKillId).toBe(2);
    respond(); game.handleWolfChatSubmit(); flush(); await settle();
    expect(game.wolfChat.map(item => item.speakerId)).toEqual([1, 1, 7, 9]);
    expect(ai.generateWolfChat.mock.calls[1][7].confirmedTargetId).toBe(2);
  });

  it('coordinates with all three AI teammates on the 12-player board', async () => {
    start(MODE_12_PLAYER); game.setPhase(GamePhase.NIGHT_WEREWOLVES); flush(); respond();
    send('I will lead. Keep your public reasoning independent.'); await settle();
    expect(game.wolfChat.map(item => item.speakerId)).toEqual([1, 2, 3, 4]);
    expect(ai.generateWolfChat).toHaveBeenCalledTimes(3);
  });

  it('keeps a confirmed kill and offers an explicit guarded skip', async () => {
    begin(); game.skipWolfChat(); flush(); expect(game.phase).toBe(GamePhase.NIGHT_WEREWOLVES);
    game.handlePlayerAction(2); flush();
    game.handlePlayerAction(3); flush(); expect(game.nightState.wolfKillId).toBe(2);
    expect(game.phase).toBe(GamePhase.NIGHT_WEREWOLVES);
    expect(game.wolfCountdown).toBe(120);
    game.skipWolfChat(); flush(); expect(game.phase).toBe(GamePhase.NIGHT_SEER);
    game.skipWolfChat(); flush(); expect(game.nightState.wolfKillId).toBe(2);
  });

  it('finishes at 120 seconds with the human kill intact', async () => {
    begin(); game.handlePlayerAction(3); flush(); await advance(119_999);
    expect(game.phase).toBe(GamePhase.NIGHT_WEREWOLVES);
    await advance(1); expect(game.phase).toBe(GamePhase.NIGHT_SEER);
    expect(game.nightState.wolfKillId).toBe(3);
    expect(ai.generateAIAction).not.toHaveBeenCalled();
  });

  it('uses the existing AI action selector when the human has not confirmed a kill', async () => {
    begin(); ai.generateAIAction.mockResolvedValueOnce({ targetId: 4 });
    await advance(120_000);
    expect(ai.generateAIAction.mock.calls[0][3]).toBe('KILL');
    expect(ai.generateAIAction.mock.calls[0][0].isHuman).toBe(false);
    expect(game.nightState.wolfKillId).toBe(4);
    expect(game.phase).toBe(GamePhase.NIGHT_SEER);
  });

  it('validates an illegal AI target at timeout and recovers from action failure', async () => {
    begin(); ai.generateAIAction.mockResolvedValueOnce({ targetId: 7 }); await advance(120_000);
    expect(game.nightState.wolfKillId).toBe(5);
    begin(); ai.generateAIAction.mockRejectedValueOnce(new Error('action failed')); await advance(120_000);
    expect(game.phase).toBe(GamePhase.NIGHT_SEER); expect(game.nightState.wolfKillId).toBe(5);
    expect(game.isProcessingAI).toBe(false);
  });

  it('advances without hanging when no legal kill target remains', async () => {
    start({ ...wolfFixture, playerCount: 3, roles: [Role.WEREWOLF, Role.WEREWOLF, Role.WEREWOLF] });
    game.setPhase(GamePhase.NIGHT_WEREWOLVES); flush();
    await advance(120_000);
    expect(game.phase).toBe(GamePhase.NIGHT_SEER);
    expect(game.nightState.wolfKillId).toBeNull();
    expect(game.isProcessingAI).toBe(false);
  });

  it('does not let non-wolves speak or read generated private log entries', async () => {
    game.setPhase(GamePhase.NIGHT_WEREWOLVES); flush(); respond();
    send('Private instruction should not be sent.'); await advance(700);
    expect(game.wolfChat.every(item => item.speakerId !== 1)).toBe(true);
    expect(game.logs.some(log => log.tone === 'wolf')).toBe(false);
  });

  it('retains private context for wolf daytime expression and subsequent nights only', async () => {
    begin(); respond(); send('Player 7, please claim Seer tomorrow.'); await settle();
    game.handlePlayerAction(2); flush(); game.skipWolfChat(); flush();
    game.setPhase(GamePhase.DAY_HUNTER_CHECK); flush(); await advance(700); await advance(700);
    expect(game.currentSpeaker?.id).toBe(1);
    game.setUserInput('I will listen.'); flush(); game.handleHumanSpeechSubmit(); flush();
    for (let turn = 0; turn < 9; turn++) await advance(700);
    const wolfCalls = ai.generateAIDialogue.mock.calls.filter(args => args[0].role === Role.WEREWOLF);
    expect(wolfCalls.length).toBeGreaterThan(0);
    expect(wolfCalls[0][11][0].message).toContain('claim Seer');
    for (const args of ai.generateAIDialogue.mock.calls.filter(args => args[0].role !== Role.WEREWOLF)) expect(args[11]).toEqual([]);
    const historyLength = game.wolfChat.length;
    game.setPhase(GamePhase.NIGHT_START); flush(); await advance(700);
    expect(game.wolfChat).toHaveLength(historyLength);
    leave(); start(); expect(game.wolfChat).toEqual([]);
  });

  it('rejects overlong messages whole and discards in-flight replies on leave', async () => {
    begin(); send('x'.repeat(1201)); await settle(); expect(game.wolfChat).toHaveLength(0);
    const held = deferred<ReturnType<typeof entry>[]>(); ai.generateWolfChat.mockReturnValueOnce(held.promise);
    send('Player 7, lead.'); await settle(); leave(); start(); const expected = snapshot();
    held.resolve([entry(7)]); await settle(); expect(snapshot()).toBe(expected);
  });
});

describe('stable model routes and provenance lifecycle', () => {
  const models = [
    { id: 'gemini-3.6-flash' as const, label: 'Gemini', description: '', available: true },
    { id: 'deepseek-flash' as const, label: 'Flash', description: '', available: true },
    { id: 'deepseek-v4-pro' as const, label: 'Pro', description: '', available: true },
  ];
  it.each([MODE_9_PLAYER, MODE_12_PLAYER])('assigns every model independently of style in $id and resets new games', config => {
    game.startGame(config, 'en', { selection: 'multi-ai-model', models }); flush();
    expect(game.players[0].aiAssignedModel).toBeUndefined();
    expect(game.players.slice(1).map(player => player.aiAssignedModel)).toEqual(Array.from({ length: config.roles.length - 1 }, (_, i) => models[i % 3].id));
    expect(game.players.slice(1).every(player => player.aiStyleId && player.aiSpeechPersonaId)).toBe(true);
    game.startGame(config, 'en', { selection: 'deepseek-v4-pro', models }); flush();
    expect(game.players.slice(1).every(player => player.aiAssignedModel === 'deepseek-v4-pro' && !player.aiDialogueSource)).toBe(true);
  });
  it('updates accepted provenance only on active commit and stores it on the speech log', async () => {
    ai.generateAIDialogue.mockImplementationOnce(async (...args) => {
      args[10].deferCommit(() => args[10].onSource({ model: 'gemini-2.5-flash', fallback: true }));
      return { en: 'An accepted provider fallback statement.', zh: '' };
    });
    await enterAIStatement(); await settle();
    const speaker = ai.generateAIDialogue.mock.calls[0][0];
    expect(game.players.find(player => player.id === speaker.id)?.aiDialogueSource).toEqual({ model: 'gemini-2.5-flash', fallback: true });
    expect(game.logs.find(log => log.message === 'An accepted provider fallback statement.')?.dialogueSource).toEqual({ model: 'gemini-2.5-flash', fallback: true });
  });
  it('discards old source commits after a new match starts', async () => {
    const held = deferred<{ en: string; zh: string }>();
    ai.generateAIDialogue.mockImplementationOnce((...args) => {
      args[10].deferCommit(() => args[10].onSource({ model: 'deepseek-v4-pro', fallback: false }));
      return held.promise;
    });
    await enterAIStatement(); leave(); start(); const expected = snapshot();
    held.resolve({ en: 'Old source must not appear.', zh: '' }); await settle();
    expect(snapshot()).toBe(expected);
    expect(game.players.every(player => player.aiDialogueSource === undefined)).toBe(true);
  });
  it('advances an empty mixed pool without adding AI dialogue to logs, replay or audio', async () => {
    const realCreate = replay.createReplayRecorder;
    const recordSpeech = vi.fn();
    const recordWolfChat = vi.fn();
    vi.spyOn(replay, 'createReplayRecorder').mockImplementation(options => ({
      ...realCreate(options), recordSpeech, recordWolfChat,
    }));
    game.startGame(fixture, 'en', { selection: 'multi-ai-model', models: [] }); flush();
    await enterAIStatement();
    for (let turn = 0; turn < 9; turn++) await advance(700);
    expect(game.phase).toBe(GamePhase.DAY_VOTING);
    expect(game.currentSpeaker).toBeNull();
    expect(game.isProcessingAI).toBe(false);
    expect(game.logs.filter(log => log.speakerId && !log.isSystem).map(log => log.speakerId)).toEqual([1]);
    expect(game.logs.some(log => log.isSystem && log.message.includes('speech was skipped'))).toBe(true);
    expect(game.players.slice(1).every(player => player.aiDialogueSource?.model === 'unavailable')).toBe(true);
    expect(recordSpeech.mock.calls.map(([speech]) => speech.speakerId)).toEqual([1]);
    expect(recordWolfChat).not.toHaveBeenCalled();
    expect(audio.enqueue).not.toHaveBeenCalled();
  });
  it('keeps non-wolves’ seat badges and logs private when a night model takes over', async () => {
    game.startGame(fixture, 'en', { selection: 'multi-ai-model', models }); flush();
    ai.generateWolfChat.mockImplementationOnce(async ([wolf]) => [{
      id: 'night-reply', round: 1, speakerId: wolf.id, message: 'An accepted simulated reply.',
      strategyTag: '刀口', dialogueSource: { model: 'deepseek-flash', fallback: true },
    }]);
    game.setPhase(GamePhase.NIGHT_WEREWOLVES); flush(); await advance(700);
    expect(game.wolfChat).toHaveLength(1);
    expect(game.logs.some(log => log.tone === 'wolf')).toBe(false);
    expect(game.players.every(player => player.aiDialogueSource === undefined)).toBe(true);
    expect(game.phase).toBe(GamePhase.NIGHT_SEER);
    expect(audio.enqueue).not.toHaveBeenCalled();
  });
  it('aborts mixed day generation on a new match before any stale audio or source commit', async () => {
    const held = deferred<{ en: string; zh: string }>();
    const commit = vi.fn();
    ai.generateAIDialogue.mockImplementationOnce((...args) => {
      args[10].deferCommit(commit);
      return held.promise;
    });
    game.startGame(fixture, 'en', { selection: 'multi-ai-model', models }); flush();
    await enterAIStatement();
    const signal: AbortSignal = ai.generateAIDialogue.mock.calls[0][10].signal;
    game.startGame(fixture, 'en', { selection: 'multi-ai-model', models }); flush();
    expect(signal.aborted).toBe(true);
    held.resolve({ en: 'Stale mixed dialogue', zh: '' }); await settle();
    expect(commit).not.toHaveBeenCalled();
    expect(audio.enqueue).not.toHaveBeenCalled();
    expect(game.players.every(player => player.aiDialogueSource === undefined)).toBe(true);
  });
});

describe('opening ceremony hold', () => {
  it('keeps the first night waiting until releaseIntro, then progresses normally', async () => {
    leave();
    game.startGame(fixture, 'en', { holdForIntro: true }); flush();
    expect(game.introPending).toBe(true);
    expect(game.phase).toBe(GamePhase.NIGHT_START);
    await advance(5000);
    expect(game.phase).toBe(GamePhase.NIGHT_START);
    expect(game.roundCount).toBe(0);

    game.releaseIntro(); flush();
    expect(game.introPending).toBe(false);
    await advance(700);
    expect(game.phase).toBe(GamePhase.NIGHT_WEREWOLVES);
    expect(game.roundCount).toBe(1);
  });

  it('never holds unless asked, and leaving clears a pending hold', async () => {
    expect(game.introPending).toBe(false);
    leave();
    game.startGame(fixture, 'en', { holdForIntro: true }); flush();
    leave();
    expect(game.introPending).toBe(false);
    expect(game.phase).toBe(GamePhase.LOBBY);
  });
});

describe('human self-vote settlement', () => {
  it.each(Object.values(Role))('records the deciding self-ballot for %s and applies the existing exile rule', async role => {
    const roles = [...MODE_12_PLAYER.roles];
    const oldSeat = roles.indexOf(role);
    [roles[0], roles[oldSeat]] = [roles[oldSeat], roles[0]];
    start({ ...MODE_12_PLAYER, roles });
    game.setPhase(GamePhase.DAY_VOTING); flush();
    game.handlePlayerAction(1); flush();
    await advance(3_000);
    expect(game.voteRecords.find(v => v.voterId === 1)?.targetId).toBe(1);
    expect(game.me).toMatchObject({ isAlive: role === Role.IDIOT, canVote: false });
    if (role === Role.HUNTER) {
      expect(game.phase).toBe(GamePhase.DAY_HUNTER_SHOT);
      game.handlePlayerAction(2); flush();
      expect(game.players[1].isAlive).toBe(false);
    }
    if (role === Role.IDIOT) {
      game.setPhase(GamePhase.DAY_VOTING); flush();
      game.handlePlayerAction(1); flush(); await advance(3_000);
      expect(game.voteRecords.filter(v => v.voterId === 1).at(-1)?.targetId).toBeNull();
    }
  });
});
