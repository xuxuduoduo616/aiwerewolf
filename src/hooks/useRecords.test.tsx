import { describe, expect, it } from 'vitest';
import { Role, type GameRecord } from '../types';
import {
  LEGACY_GUEST_RECORD_KEY,
  getGuestRecordStorageKey,
  loadGuestRecords,
  saveGuestRecords,
  visibleRecordsForOwner,
} from './useRecords';

const guestA = 'guest:11111111-1111-4111-8111-111111111111';
const guestB = 'guest:22222222-2222-4222-8222-222222222222';

const record = (userId = 'guest'): GameRecord => ({
  id: 'local-1', userId, boardId: '9-standard', role: Role.SEER,
  result: 'WIN', rounds: 4, summary: 'Local summary', createdAt: '2026-08-28T00:00:00.000Z',
});

const memoryStorage = () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
  return { values, storage };
};

describe('guest record ownership', () => {
  it('never loads or migrates legacy guest history', () => {
    const { storage, values } = memoryStorage();
    storage.setItem(LEGACY_GUEST_RECORD_KEY, JSON.stringify([record()]));
    const before = [...values];
    expect(loadGuestRecords(guestA, storage)).toEqual([]);
    expect(loadGuestRecords(guestB, storage)).toEqual([]);
    expect([...values]).toEqual(before);
  });

  it('never writes new guest records or alters existing data', () => {
    const { storage, values } = memoryStorage();
    storage.setItem(getGuestRecordStorageKey(guestA), 'existing-history');
    const before = [...values];
    expect(saveGuestRecords(guestA, [record(guestA)], storage)).toBe(false);
    expect(loadGuestRecords(guestA, storage)).toEqual([]);
    expect([...values]).toEqual(before);
  });

  it('hides stale account A or guest records synchronously when principal changes', () => {
    const accountA = { owner: 'account:a', records: [record('a')] };
    expect(visibleRecordsForOwner(accountA, 'account:b')).toEqual([]);
    expect(visibleRecordsForOwner(accountA, guestA)).toEqual([]);
    expect(visibleRecordsForOwner(accountA, 'account:a')).toHaveLength(1);
  });
});
