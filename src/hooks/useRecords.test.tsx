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
  it('migrates valid legacy records only to the first guest principal', () => {
    const { storage } = memoryStorage();
    storage.setItem(LEGACY_GUEST_RECORD_KEY, JSON.stringify([record()]));
    expect(loadGuestRecords(guestA, storage)).toEqual([expect.objectContaining({ userId: guestA })]);
    expect(loadGuestRecords(guestB, storage)).toEqual([]);
  });

  it('isolates active keys and never overwrites an existing target with legacy data', () => {
    const { storage } = memoryStorage();
    expect(saveGuestRecords(guestA, [record(guestA)], storage)).toBe(true);
    storage.setItem(LEGACY_GUEST_RECORD_KEY, JSON.stringify([{ ...record(), id: 'legacy-other' }]));
    expect(loadGuestRecords(guestA, storage).map(item => item.id)).toEqual(['local-1']);
    expect(storage.getItem(getGuestRecordStorageKey(guestA))).not.toContain('legacy-other');
    expect(loadGuestRecords(guestB, storage)).toEqual([]);
  });

  it('fails corrupt and unknown-version target envelopes closed', () => {
    const { storage } = memoryStorage();
    const target = getGuestRecordStorageKey(guestA);
    storage.setItem(target, JSON.stringify({ version: 999, records: [record()] }));
    storage.setItem(LEGACY_GUEST_RECORD_KEY, JSON.stringify([record()]));
    expect(loadGuestRecords(guestA, storage)).toEqual([]);
    expect(storage.getItem(target)).toContain('999');
  });

  it('hides stale account A or guest records synchronously when principal changes', () => {
    const accountA = { owner: 'account:a', records: [record('a')] };
    expect(visibleRecordsForOwner(accountA, 'account:b')).toEqual([]);
    expect(visibleRecordsForOwner(accountA, guestA)).toEqual([]);
    expect(visibleRecordsForOwner(accountA, 'account:a')).toHaveLength(1);
  });
});
