import { useEffect, useState } from 'react';
import { Role, type GameRecord, type SupabaseSession } from '../types';
import { fetchGameRecords, isSupabaseConfigured } from '../services/supabaseClient';
import { isGuestPrincipalId } from '../identity/publicIdentity';

export const LEGACY_GUEST_RECORD_KEY = 'werewolf_guest_records';
export const GUEST_RECORD_SCHEMA = 'aiwerewolf.guest-records';
export const GUEST_RECORD_VERSION = 1 as const;
export const GUEST_RECORD_PREFIX = 'werewolf_guest_records:v1:';
export const GUEST_RECORD_MIGRATION_KEY = 'werewolf_guest_records:v1:migrated-to';

interface GuestRecordEnvelopeV1 {
  schema: typeof GUEST_RECORD_SCHEMA;
  version: typeof GUEST_RECORD_VERSION;
  principalId: string;
  records: GameRecord[];
}

export const getGuestRecordStorageKey = (principalId: string): string =>
  `${GUEST_RECORD_PREFIX}${principalId}`;

const isRecordArray = (value: unknown): value is GameRecord[] =>
  Array.isArray(value) && value.length <= 20 && value.every(record => (
    record
    && typeof record === 'object'
    && typeof (record as GameRecord).id === 'string'
    && typeof (record as GameRecord).userId === 'string'
    && ((record as GameRecord).boardId === '9-standard' || (record as GameRecord).boardId === '12-standard')
    && Object.values(Role).includes((record as GameRecord).role)
    && ((record as GameRecord).result === 'WIN' || (record as GameRecord).result === 'LOSE')
    && Number.isSafeInteger((record as GameRecord).rounds)
    && (record as GameRecord).rounds >= 0
    && typeof (record as GameRecord).summary === 'string'
    && typeof (record as GameRecord).createdAt === 'string'
    && Number.isFinite(Date.parse((record as GameRecord).createdAt))
  ));

const parseEnvelope = (raw: string, principalId: string): GameRecord[] | null => {
  try {
    const value = JSON.parse(raw) as Partial<GuestRecordEnvelopeV1> | null;
    if (
      !value
      || value.schema !== GUEST_RECORD_SCHEMA
      || value.version !== GUEST_RECORD_VERSION
      || value.principalId !== principalId
      || !isRecordArray(value.records)
    ) return null;
    return value.records.map(record => ({ ...record, userId: principalId }));
  } catch {
    return null;
  }
};

export const loadGuestRecords = (principalId: string, storage: Storage | null): GameRecord[] => {
  if (!isGuestPrincipalId(principalId) || !storage) return [];
  const targetKey = getGuestRecordStorageKey(principalId);
  try {
    const target = storage.getItem(targetKey);
    if (target !== null) {
      if (
        storage.getItem(GUEST_RECORD_MIGRATION_KEY) === null
        && storage.getItem(LEGACY_GUEST_RECORD_KEY) !== null
      ) {
        try { storage.setItem(GUEST_RECORD_MIGRATION_KEY, principalId); } catch {}
      }
      return parseEnvelope(target, principalId) ?? [];
    }

    if (storage.getItem(GUEST_RECORD_MIGRATION_KEY) !== null) return [];
    const legacy = storage.getItem(LEGACY_GUEST_RECORD_KEY);
    if (legacy === null) return [];
    const parsedLegacy = JSON.parse(legacy) as unknown;
    if (!isRecordArray(parsedLegacy)) return [];
    const records = parsedLegacy.map(record => ({ ...record, userId: principalId })).slice(0, 20);
    const envelope: GuestRecordEnvelopeV1 = {
      schema: GUEST_RECORD_SCHEMA,
      version: GUEST_RECORD_VERSION,
      principalId,
      records,
    };
    storage.setItem(targetKey, JSON.stringify(envelope));
    storage.setItem(GUEST_RECORD_MIGRATION_KEY, principalId);
    return records;
  } catch {
    return [];
  }
};

export const saveGuestRecords = (
  principalId: string,
  records: GameRecord[],
  storage: Storage | null,
): boolean => {
  if (!isGuestPrincipalId(principalId) || !storage || !isRecordArray(records)) return false;
  const envelope: GuestRecordEnvelopeV1 = {
    schema: GUEST_RECORD_SCHEMA,
    version: GUEST_RECORD_VERSION,
    principalId,
    records: records.map(record => ({ ...record, userId: principalId })).slice(0, 20),
  };
  try {
    storage.setItem(getGuestRecordStorageKey(principalId), JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
};

const browserStorage = (): Storage | null => {
  try { return globalThis.localStorage ?? null; } catch { return null; }
};

export interface RecordSnapshot {
  owner: string;
  records: GameRecord[];
}

export const visibleRecordsForOwner = (snapshot: RecordSnapshot, activeOwner: string): GameRecord[] =>
  snapshot.owner === activeOwner ? snapshot.records : [];

export function useRecords(session: SupabaseSession | null, guestPrincipalId: string | null = null) {
  const activeOwner = session ? `account:${session.user.id}` : guestPrincipalId ?? 'none';
  const [snapshot, setSnapshot] = useState<RecordSnapshot>({ owner: activeOwner, records: [] });
  const [recordError, setRecordError] = useState('');
  const [showRecords, setShowRecords] = useState(false);

  const records = visibleRecordsForOwner(snapshot, activeOwner);
  const setRecords: React.Dispatch<React.SetStateAction<GameRecord[]>> = update => {
    setSnapshot(previous => {
      const current = previous.owner === activeOwner ? previous.records : [];
      const next = typeof update === 'function' ? update(current) : update;
      return { owner: activeOwner, records: next };
    });
  };

  const loadLocalRecords = (principalId = guestPrincipalId) => {
    const next = principalId ? loadGuestRecords(principalId, browserStorage()) : [];
    setSnapshot({ owner: principalId ?? 'none', records: next });
  };

  useEffect(() => {
    if (session) {
      setSnapshot(previous => previous.owner === activeOwner ? previous : { owner: activeOwner, records: [] });
      if (!isSupabaseConfigured()) return;
      fetchGameRecords(session)
        .then(nextRecords => {
          setSnapshot({ owner: activeOwner, records: nextRecords });
          setRecordError('');
        })
        .catch(error => {
          setSnapshot({ owner: activeOwner, records: [] });
          setRecordError(error.message || 'Could not load game records.');
        });
      return;
    }
    if (guestPrincipalId) loadLocalRecords(guestPrincipalId);
    else setSnapshot({ owner: 'none', records: [] });
  }, [activeOwner, guestPrincipalId, session]);

  return {
    records,
    setRecords,
    recordError,
    setRecordError,
    showRecords,
    setShowRecords,
    loadLocalRecords,
  };
}
