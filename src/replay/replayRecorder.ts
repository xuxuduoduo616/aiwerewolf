/**
 * H2-A: pure replay builder plus a small in-memory recorder.
 *
 * Nothing in this module reads storage, the network or the DOM. The recorder
 * only accumulates arrays while a match is running; `finalize()` produces the
 * single `ReplayRecord` that `replayStore.saveReplay` persists at `GAME_OVER`.
 */

import { GamePhase, Role } from '../types';
import {
  REPLAY_SCHEMA_VERSION,
  type ReplayBeliefScore,
  type ReplayBeliefSnapshot,
  type ReplayCheck,
  type ReplayDraft,
  type ReplayPhaseEntry,
  type ReplayPlayerSeat,
  type ReplayRecord,
  type ReplayRecorderInput,
  type ReplaySpeech,
  type ReplayVote,
  type ReplayWolfChatEntry,
} from './replayTypes';

const ROLE_VALUES = new Set<string>(Object.values(Role));
const PHASE_VALUES = new Set<string>(Object.values(GamePhase));

const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && ROLE_VALUES.has(value);

const isPhase = (value: unknown): value is GamePhase =>
  typeof value === 'string' && PHASE_VALUES.has(value);

const toSeat = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const seat = Math.trunc(value);
  return seat > 0 ? seat : null;
};

const toRound = (value: unknown, minimum: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(minimum, Math.trunc(value));
};

const toScore = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
};

const canonicalPlayer = (value: ReplayPlayerSeat): ReplayPlayerSeat | null => {
  if (!value || typeof value !== 'object') return null;
  const seat = toSeat(value.seat);
  if (seat === null || !isRole(value.role) || typeof value.isHuman !== 'boolean') return null;
  return { seat, role: value.role, isHuman: value.isHuman };
};

const canonicalPlayers = (players: readonly ReplayPlayerSeat[]): ReplayPlayerSeat[] => {
  const bySeat = new Map<number, ReplayPlayerSeat>();
  for (const player of Array.isArray(players) ? players : []) {
    const canonical = canonicalPlayer(player);
    if (canonical && !bySeat.has(canonical.seat)) bySeat.set(canonical.seat, canonical);
  }
  return [...bySeat.values()].sort((a, b) => a.seat - b.seat);
};

const canonicalPhase = (value: ReplayPhaseEntry): ReplayPhaseEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const round = toRound(value.round, 0);
  if (round === null || !isPhase(value.phase)) return null;
  return { phase: value.phase, round };
};

const canonicalSpeech = (value: ReplaySpeech): ReplaySpeech | null => {
  if (!value || typeof value !== 'object') return null;
  const round = toRound(value.round, 1);
  const speakerId = toSeat(value.speakerId);
  if (round === null || speakerId === null || !isPhase(value.phase) || typeof value.text !== 'string') {
    return null;
  }
  return { round, phase: value.phase, speakerId, text: value.text };
};

const canonicalVote = (value: ReplayVote): ReplayVote | null => {
  if (!value || typeof value !== 'object') return null;
  const round = toRound(value.round, 1);
  const voterId = toSeat(value.voterId);
  if (round === null || voterId === null) return null;
  let targetId: number | null = null;
  if (value.targetId !== null) {
    targetId = toSeat(value.targetId);
    if (targetId === null) return null;
  }
  const base: ReplayVote = { round, voterId, targetId };
  // Keep the key absent (not `undefined`) so the export never quotes it.
  if (typeof value.reason === 'string' && value.reason.length > 0) {
    return { ...base, reason: value.reason };
  }
  return base;
};

const canonicalBeliefSnapshot = (value: ReplayBeliefSnapshot): ReplayBeliefSnapshot | null => {
  if (!value || typeof value !== 'object') return null;
  const round = toRound(value.round, 1);
  const actorId = toSeat(value.actorId);
  if (round === null || actorId === null || !Array.isArray(value.scores)) return null;
  const seen = new Set<number>();
  const scores: ReplayBeliefScore[] = [];
  for (const entry of value.scores) {
    if (!entry || typeof entry !== 'object') continue;
    const targetId = toSeat(entry.targetId);
    const score = toScore(entry.score);
    if (targetId === null || score === null || targetId === actorId || seen.has(targetId)) continue;
    seen.add(targetId);
    scores.push({ targetId, score });
  }
  scores.sort((a, b) => (b.score - a.score) || (a.targetId - b.targetId));
  return { round, actorId, scores };
};

const canonicalWolfChat = (value: ReplayWolfChatEntry): ReplayWolfChatEntry | null => {
  if (!value || typeof value !== 'object') return null;
  const round = toRound(value.round, 1);
  const speakerId = toSeat(value.speakerId);
  if (round === null || speakerId === null || typeof value.message !== 'string') return null;
  return { round, speakerId, message: value.message };
};

const canonicalCheck = (value: ReplayCheck): ReplayCheck | null => {
  if (!value || typeof value !== 'object') return null;
  const round = toRound(value.round, 1);
  const actorId = toSeat(value.actorId);
  const targetId = toSeat(value.targetId);
  if (round === null || actorId === null || targetId === null || typeof value.isGood !== 'boolean') {
    return null;
  }
  return { round, actorId, targetId, isGood: value.isGood };
};

const canonicalizeList = <T>(values: readonly T[], build: (value: T) => T | null): T[] => {
  const result: T[] = [];
  for (const value of Array.isArray(values) ? values : []) {
    const canonical = build(value);
    if (canonical) result.push(canonical);
  }
  return result;
};

const normalizeGameId = (value?: string): string => {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return createGameId();
};

const normalizeTimestamp = (value?: string): string => {
  if (typeof value === 'string' && value.length > 0) return value;
  return new Date().toISOString();
};

const createGameId = (): string => {
  try {
    const source = globalThis.crypto;
    if (source && typeof source.randomUUID === 'function') return source.randomUUID();
  } catch {
    // Fall through to a non-cryptographic local id.
  }
  return `replay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Pure builder: validates/coerces every entry, fixes key order and returns a
 * complete `ReplayRecord`. Invalid entries are dropped instead of stored.
 */
export const buildReplay = (draft: ReplayDraft): ReplayRecord => {
  const players = canonicalPlayers(draft.players);
  const phases = canonicalizeList(draft.phases, canonicalPhase);
  const speeches = canonicalizeList(draft.speeches, canonicalSpeech);
  const votes = canonicalizeList(draft.votes, canonicalVote);
  const beliefSnapshots = canonicalizeList(draft.beliefSnapshots, canonicalBeliefSnapshot)
    .sort((a, b) => (a.round - b.round) || (a.actorId - b.actorId));
  const wolfChat = canonicalizeList(draft.wolfChat, canonicalWolfChat);
  const checks = canonicalizeList(draft.checks, canonicalCheck);
  const rounds = toRound(draft.outcome?.rounds, 1);

  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    gameId: normalizeGameId(draft.gameId),
    createdAt: normalizeTimestamp(draft.createdAt),
    boardId: draft.boardId,
    difficulty: draft.difficulty,
    language: draft.language,
    isGuest: Boolean(draft.isGuest),
    players,
    phases,
    speeches,
    votes,
    beliefSnapshots,
    wolfChat,
    checks,
    outcome: {
      winner: draft.outcome.winner,
      rounds: rounds ?? 1,
    },
  };
};

/**
 * Re-canonicalize an existing record (for the store and for `exportReplay`).
 * The returned object has the same fixed key order as `buildReplay`.
 */
export const canonicalizeReplay = (record: ReplayRecord): ReplayRecord => buildReplay({
  gameId: record.gameId,
  createdAt: record.createdAt,
  boardId: record.boardId,
  difficulty: record.difficulty,
  language: record.language,
  isGuest: record.isGuest,
  players: record.players,
  phases: record.phases,
  speeches: record.speeches,
  votes: record.votes,
  beliefSnapshots: record.beliefSnapshots,
  wolfChat: record.wolfChat,
  checks: record.checks,
  outcome: record.outcome,
});

export interface ReplayRecorder {
  readonly gameId: string;
  recordPhase(phase: GamePhase, round: number): void;
  recordSpeech(speech: ReplaySpeech): void;
  recordVote(vote: ReplayVote): void;
  recordCheck(check: ReplayCheck): void;
  recordWolfChat(entry: ReplayWolfChatEntry): void;
  recordBeliefSnapshots(snapshots: readonly ReplayBeliefSnapshot[]): void;
  /** Returns the replay once; later calls return `null` (idempotent). */
  finalize(outcome: { winner: 'VILLAGERS' | 'WEREWOLVES'; rounds: number }): ReplayRecord | null;
  isFinalized(): boolean;
}

/**
 * In-memory recorder. Repeated renders may call the same record method again;
 * phases, votes, checks and belief snapshots are de-duplicated, and `finalize`
 * is a one-shot operation.
 */
export const createReplayRecorder = (input: ReplayRecorderInput): ReplayRecorder => {
  const gameId = normalizeGameId(input.gameId);
  // Generated at finalize() time so it means "when the replay was written",
  // not "when the match started".
  const createdAt = typeof input.createdAt === 'string' && input.createdAt.length > 0
    ? input.createdAt
    : undefined;
  const players = canonicalPlayers(input.players);
  const phases: ReplayPhaseEntry[] = [];
  const speeches: ReplaySpeech[] = [];
  const votes: ReplayVote[] = [];
  const checks: ReplayCheck[] = [];
  const wolfChat: ReplayWolfChatEntry[] = [];
  const beliefSnapshots: ReplayBeliefSnapshot[] = [];
  const phaseKeys = new Set<string>();
  const voteKeys = new Set<string>();
  const checkKeys = new Set<string>();
  const beliefKeys = new Set<string>();
  let finalized = false;

  return {
    gameId,
    recordPhase(phase, round) {
      if (finalized) return;
      const entry = canonicalPhase({ phase, round });
      if (!entry) return;
      const key = `${entry.phase}:${entry.round}`;
      if (phaseKeys.has(key)) return;
      phaseKeys.add(key);
      phases.push(entry);
    },
    recordSpeech(speech) {
      if (finalized) return;
      const entry = canonicalSpeech(speech);
      if (entry) speeches.push(entry);
    },
    recordVote(vote) {
      if (finalized) return;
      const entry = canonicalVote(vote);
      if (!entry) return;
      const key = `${entry.round}:${entry.voterId}`;
      if (voteKeys.has(key)) return;
      voteKeys.add(key);
      votes.push(entry);
    },
    recordCheck(check) {
      if (finalized) return;
      const entry = canonicalCheck(check);
      if (!entry) return;
      const key = `${entry.round}:${entry.actorId}`;
      if (checkKeys.has(key)) return;
      checkKeys.add(key);
      checks.push(entry);
    },
    recordWolfChat(entry) {
      if (finalized) return;
      const canonical = canonicalWolfChat(entry);
      if (canonical) wolfChat.push(canonical);
    },
    recordBeliefSnapshots(snapshots) {
      if (finalized) return;
      for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
        const entry = canonicalBeliefSnapshot(snapshot);
        if (!entry) continue;
        const key = `${entry.round}:${entry.actorId}`;
        if (beliefKeys.has(key)) continue;
        beliefKeys.add(key);
        beliefSnapshots.push(entry);
      }
    },
    finalize(outcome) {
      if (finalized) return null;
      const winner = outcome?.winner;
      if (winner !== 'VILLAGERS' && winner !== 'WEREWOLVES') return null;
      const rounds = toRound(outcome.rounds, 1);
      if (rounds === null) return null;
      finalized = true;
      return buildReplay({
        gameId,
        createdAt,
        boardId: input.boardId,
        difficulty: input.difficulty,
        language: input.language,
        isGuest: input.isGuest,
        players,
        phases,
        speeches,
        votes,
        beliefSnapshots,
        wolfChat,
        checks,
        outcome: { winner, rounds },
      });
    },
    isFinalized: () => finalized,
  };
};
