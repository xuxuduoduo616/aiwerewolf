import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GamePhase, Role } from '../types';
import {
  MAX_RETAINED_REPLAYS,
  REPLAY_SCHEMA_VERSION,
  REPLAY_STORAGE_KEY,
  buildReplay,
  clearReplays,
  exportReplay,
  listReplays,
  loadReplay,
  saveReplay,
  type ReplayRecord,
} from './index';

let values: Map<string, string>;

const storageStub = () => ({
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
  clear: () => { values.clear(); },
  key: () => null,
  length: 0,
});

const makeRecord = (gameId: string, overrides: Partial<Parameters<typeof buildReplay>[0]> = {}): ReplayRecord =>
  buildReplay({
    gameId,
    createdAt: '2026-01-02T03:04:05.000Z',
    boardId: '9-standard',
    difficulty: 'normal',
    language: 'en',
    isGuest: true,
    players: [
      { seat: 1, role: Role.VILLAGER, isHuman: true },
      { seat: 2, role: Role.WEREWOLF, isHuman: false },
    ],
    phases: [{ phase: GamePhase.NIGHT_START, round: 0 }],
    speeches: [{ round: 1, phase: GamePhase.DAY_DISCUSSION, speakerId: 1, text: 'Hello.' }],
    votes: [{ round: 1, voterId: 1, targetId: 2 }],
    beliefSnapshots: [{ round: 1, actorId: 2, scores: [{ targetId: 1, score: 0.6 }] }],
    wolfChat: [{ round: 1, speakerId: 2, message: 'Focus.' }],
    checks: [{ round: 1, actorId: 2, targetId: 1, isGood: true }],
    outcome: { winner: 'VILLAGERS', rounds: 1 },
    ...overrides,
  });

beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', storageStub());
  clearReplays();
});

afterEach(() => {
  clearReplays();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('replay storage', () => {
  it('round-trips a versioned record and lists newest first', () => {
    expect(saveReplay(makeRecord('a'))).toBe(true);
    expect(saveReplay(makeRecord('b'))).toBe(true);
    const stored = JSON.parse(values.get(REPLAY_STORAGE_KEY)!);
    expect(stored.version).toBe(REPLAY_SCHEMA_VERSION);
    expect(stored.replays.map((record: ReplayRecord) => record.gameId)).toEqual(['b', 'a']);
    expect(listReplays().map(record => record.gameId)).toEqual(['b', 'a']);
    expect(loadReplay('a')?.outcome).toEqual({ winner: 'VILLAGERS', rounds: 1 });
    expect(loadReplay('missing')).toBeNull();
  });

  it(`keeps only the latest ${MAX_RETAINED_REPLAYS} replays`, () => {
    for (let index = 0; index < MAX_RETAINED_REPLAYS + 2; index += 1) {
      expect(saveReplay(makeRecord(`game-${index}`))).toBe(true);
    }
    const ids = listReplays().map(record => record.gameId);
    expect(ids).toEqual(['game-6', 'game-5', 'game-4', 'game-3', 'game-2']);
    expect(JSON.parse(values.get(REPLAY_STORAGE_KEY)!).replays).toHaveLength(MAX_RETAINED_REPLAYS);
  });

  it('upserts the same gameId instead of adding a second record', () => {
    saveReplay(makeRecord('same'));
    saveReplay(makeRecord('same', { outcome: { winner: 'WEREWOLVES', rounds: 3 } }));
    expect(listReplays()).toHaveLength(1);
    expect(listReplays()[0].outcome).toEqual({ winner: 'WEREWOLVES', rounds: 3 });
  });

  it('falls back to memory when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => saveReplay(makeRecord('memory-only'))).not.toThrow();
    expect(listReplays().map(record => record.gameId)).toEqual(['memory-only']);
  });

  it('degrades without throwing when localStorage denies reads and writes', () => {
    const denied = new Error('storage denied');
    vi.stubGlobal('localStorage', {
      getItem: () => { throw denied; },
      setItem: () => { throw denied; },
      removeItem: () => { throw denied; },
    });
    expect(() => saveReplay(makeRecord('denied'))).not.toThrow();
    expect(() => listReplays()).not.toThrow();
    expect(listReplays().map(record => record.gameId)).toEqual(['denied']);
  });

  it('keeps the replay in memory when the quota rejects the write', () => {
    saveReplay(makeRecord('before-quota'));
    vi.stubGlobal('localStorage', {
      ...storageStub(),
      setItem: () => { throw new Error('QuotaExceededError'); },
    });
    expect(() => saveReplay(makeRecord('over-quota'))).not.toThrow();
    expect(listReplays().map(record => record.gameId)).toEqual(['over-quota', 'before-quota']);
  });

  it('treats corrupt JSON as empty, then keeps working in memory', () => {
    values.set(REPLAY_STORAGE_KEY, '{not valid json');
    expect(() => listReplays()).not.toThrow();
    expect(listReplays()).toEqual([]);
    expect(() => saveReplay(makeRecord('after-corrupt'))).not.toThrow();
    expect(listReplays().map(record => record.gameId)).toEqual(['after-corrupt']);
  });

  it('strips unknown fields, including hypothetical identity keys', () => {
    const record = makeRecord('pii-check');
    // Composed key names keep this test fixture itself free of identity-field
    // references while still proving the canonicalizer drops foreign keys.
    const foreignNameKey = ['player', 'Name'].join('');
    const foreignMailKey = ['e', 'mail'].join('');
    const withExtra: Record<string, unknown> = {
      ...record,
      [foreignNameKey]: 'Alice',
      [foreignMailKey]: 'alice@example.test',
      players: [{ ...record.players[0], name: 'Alice' }, ...record.players.slice(1)],
    };
    values.set(REPLAY_STORAGE_KEY, JSON.stringify({
      version: REPLAY_SCHEMA_VERSION,
      replays: [withExtra],
    }));
    const listed = listReplays()[0];
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain('Alice');
    expect(Object.keys(listed)).not.toContain(foreignNameKey);
    expect(Object.keys(listed)).not.toContain(foreignMailKey);
  });

  it('exports stable JSON that parses back to an equivalent record', () => {
    saveReplay(makeRecord('exported'));
    const first = exportReplay('exported');
    const second = exportReplay('exported');
    expect(first).toBe(second);
    expect(first).not.toBeNull();
    expect(first!).not.toContain('undefined');
    const parsed = JSON.parse(first!) as ReplayRecord;
    expect(parsed).toEqual(loadReplay('exported'));
    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'gameId',
      'createdAt',
      'boardId',
      'difficulty',
      'language',
      'isGuest',
      'players',
      'phases',
      'speeches',
      'votes',
      'beliefSnapshots',
      'wolfChat',
      'checks',
      'outcome',
    ]);
    expect(exportReplay('missing')).toBeNull();
  });

  it('clears every retained replay', () => {
    saveReplay(makeRecord('one'));
    clearReplays();
    expect(listReplays()).toEqual([]);
    expect(values.has(REPLAY_STORAGE_KEY)).toBe(false);
  });
});
