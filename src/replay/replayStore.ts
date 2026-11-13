/**
 * H2-A: local replay storage.
 *
 * Replays live under one versioned `localStorage` key and never leave the
 * browser. The newest `MAX_RETAINED_REPLAYS` records are kept; everything else
 * is trimmed from the tail (oldest first).
 *
 * Storage is best effort, mirroring `src/services/matchTelemetry.ts`: when
 * `localStorage` is missing, throws, holds corrupt JSON or rejects a write
 * because the quota is full, the module switches to an in-memory list, keeps
 * working for the rest of the session and never rethrows.
 */

import type { Difficulty } from '../types';
import {
  REPLAY_SCHEMA_VERSION,
  type ReplayBeliefSnapshot,
  type ReplayBoardId,
  type ReplayCheck,
  type ReplayLanguage,
  type ReplayPhaseEntry,
  type ReplayPlayerSeat,
  type ReplayRecord,
  type ReplaySpeech,
  type ReplayVote,
  type ReplayWinner,
  type ReplayWolfChatEntry,
} from './replayTypes';
import { buildReplay, canonicalizeReplay } from './replayRecorder';

export const REPLAY_STORAGE_KEY = 'werewolf.replays.v1';
/** Keep the most recent finished replays; older records are dropped first. */
export const MAX_RETAINED_REPLAYS = 5;

const BOARD_IDS: readonly ReplayBoardId[] = ['9-standard', '12-standard'];
const DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];
const LANGUAGES: readonly ReplayLanguage[] = ['zh', 'en'];
const WINNERS: readonly ReplayWinner[] = ['VILLAGERS', 'WEREWOLVES'];

let memoryReplays: ReplayRecord[] = [];
/**
 * Once storage fails, module memory is authoritative for the session so a
 * later read cannot resurrect stale storage without the just-saved replay.
 */
let storageDegraded = false;

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? value as Record<string, unknown> : null;

const includes = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.includes(value as T);

/**
 * Runtime validation for one stored record. Missing/foreign fields are dropped
 * by `buildReplay`; a record with an unusable core shape is ignored entirely.
 */
const toStoredReplay = (value: unknown): ReplayRecord | null => {
  const record = asObject(value);
  if (!record) return null;
  if (record.schemaVersion !== REPLAY_SCHEMA_VERSION) return null;
  if (typeof record.gameId !== 'string' || record.gameId.length === 0) return null;
  if (typeof record.createdAt !== 'string' || record.createdAt.length === 0) return null;
  if (!includes(BOARD_IDS, record.boardId)) return null;
  if (!includes(DIFFICULTIES, record.difficulty)) return null;
  if (!includes(LANGUAGES, record.language)) return null;
  if (typeof record.isGuest !== 'boolean') return null;
  if (!Array.isArray(record.players)) return null;
  if (!Array.isArray(record.phases)) return null;
  if (!Array.isArray(record.speeches)) return null;
  if (!Array.isArray(record.votes)) return null;
  if (!Array.isArray(record.beliefSnapshots)) return null;
  if (!Array.isArray(record.wolfChat)) return null;
  if (!Array.isArray(record.checks)) return null;
  const outcome = asObject(record.outcome);
  if (!outcome || !includes(WINNERS, outcome.winner)) return null;
  if (typeof outcome.rounds !== 'number' || !Number.isFinite(outcome.rounds)) return null;

  try {
    return buildReplay({
      gameId: record.gameId,
      createdAt: record.createdAt,
      boardId: record.boardId,
      difficulty: record.difficulty,
      language: record.language,
      isGuest: record.isGuest,
      players: record.players as ReplayPlayerSeat[],
      phases: record.phases as ReplayPhaseEntry[],
      speeches: record.speeches as ReplaySpeech[],
      votes: record.votes as ReplayVote[],
      beliefSnapshots: record.beliefSnapshots as ReplayBeliefSnapshot[],
      wolfChat: record.wolfChat as ReplayWolfChatEntry[],
      checks: record.checks as ReplayCheck[],
      outcome: { winner: outcome.winner, rounds: outcome.rounds },
    });
  } catch {
    return null;
  }
};

const readReplays = (): ReplayRecord[] => {
  if (storageDegraded) return memoryReplays;
  try {
    const store = storage();
    if (!store) {
      storageDegraded = true;
      return memoryReplays;
    }
    const raw = store.getItem(REPLAY_STORAGE_KEY);
    if (!raw) {
      memoryReplays = [];
      return memoryReplays;
    }
    const parsed = asObject(JSON.parse(raw) as unknown);
    const candidates = parsed && Array.isArray(parsed.replays) ? parsed.replays : null;
    if (!candidates) {
      storageDegraded = true;
      return memoryReplays;
    }
    const records: ReplayRecord[] = [];
    for (const candidate of candidates) {
      const record = toStoredReplay(candidate);
      if (record) records.push(record);
      if (records.length >= MAX_RETAINED_REPLAYS) break;
    }
    memoryReplays = records;
    return memoryReplays;
  } catch {
    // Unreadable storage or corrupt JSON: keep working from memory.
    storageDegraded = true;
    return memoryReplays;
  }
};

const writeReplays = (replays: ReplayRecord[]): void => {
  memoryReplays = replays;
  if (storageDegraded) return;
  try {
    const store = storage();
    if (!store) {
      storageDegraded = true;
      return;
    }
    store.setItem(REPLAY_STORAGE_KEY, JSON.stringify({
      version: REPLAY_SCHEMA_VERSION,
      replays,
    }));
  } catch {
    // Private mode or full quota: the in-memory list remains authoritative.
    storageDegraded = true;
  }
};

/**
 * Persist one finished replay. Saving the same `gameId` again replaces the old
 * copy instead of adding a second one (defensive against repeated triggers).
 * Returns `true` when the record was retained (storage or memory).
 */
export const saveReplay = (record: ReplayRecord): boolean => {
  try {
    const canonical = canonicalizeReplay(record);
    const existing = readReplays();
    const next = [canonical, ...existing.filter(item => item.gameId !== canonical.gameId)]
      .slice(0, MAX_RETAINED_REPLAYS);
    writeReplays(next);
    return true;
  } catch {
    return false;
  }
};

/** Newest-first copies of the retained replays; never throws. */
export const listReplays = (): ReplayRecord[] => {
  try {
    return readReplays().map(canonicalizeReplay);
  } catch {
    return [];
  }
};

/** One retained replay by id, or `null`; returns a copy. */
export const loadReplay = (id: string): ReplayRecord | null => {
  try {
    const record = readReplays().find(item => item.gameId === id);
    return record ? canonicalizeReplay(record) : null;
  } catch {
    return null;
  }
};

/**
 * Stable JSON for one replay: fixed key order, no `undefined` fields, and no
 * file/network side effect. Returns `null` when the id is unknown.
 */
export const exportReplay = (id: string): string | null => {
  try {
    const record = loadReplay(id);
    return record ? JSON.stringify(record, null, 2) : null;
  } catch {
    return null;
  }
};

/** Remove every retained replay and clear the degraded flag. */
export const clearReplays = (): void => {
  memoryReplays = [];
  storageDegraded = false;
  try {
    storage()?.removeItem(REPLAY_STORAGE_KEY);
  } catch {
    // Nothing else to clean up.
  }
};
