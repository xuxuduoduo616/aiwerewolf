import { useEffect, useState } from 'react';
import { type GameRecord, type SupabaseSession } from '../types';
import { fetchGameRecords, isSupabaseConfigured } from '../services/supabaseClient';

export const LEGACY_GUEST_RECORD_KEY = 'werewolf_guest_records';
export const GUEST_RECORD_SCHEMA = 'aiwerewolf.guest-records';
export const GUEST_RECORD_VERSION = 1 as const;
export const GUEST_RECORD_PREFIX = 'werewolf_guest_records:v1:';
export const GUEST_RECORD_MIGRATION_KEY = 'werewolf_guest_records:v1:migrated-to';

export const getGuestRecordStorageKey = (principalId: string): string =>
  `${GUEST_RECORD_PREFIX}${principalId}`;

// Guest Trial no longer retains match history. Keep the old key helpers only
// for compatibility; do not read, migrate, overwrite, or delete prior records.
export const loadGuestRecords = (_principalId: string, _storage: Storage | null): GameRecord[] => [];
export const saveGuestRecords = (_principalId: string, _records: GameRecord[], _storage: Storage | null): boolean => false;

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

  const records = session ? visibleRecordsForOwner(snapshot, activeOwner) : [];
  const setRecords: React.Dispatch<React.SetStateAction<GameRecord[]>> = update => {
    setSnapshot(previous => {
      const current = previous.owner === activeOwner ? previous.records : [];
      const next = typeof update === 'function' ? update(current) : update;
      return { owner: activeOwner, records: next };
    });
  };

  const loadLocalRecords = (principalId = guestPrincipalId) => {
    const next: GameRecord[] = [];
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
