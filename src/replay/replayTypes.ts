/**
 * H2-A: local replay schema.
 *
 * A replay is a local-only, structured record of one finished match. It is
 * written once, after `GAME_OVER`, and never contains an account id, e-mail,
 * credential or display name: the human is represented only by `seat` plus
 * `isHuman: true`.
 *
 * `schemaVersion` is the single compatibility switch. Bump it together with
 * `docs/replay-format.md` whenever a field changes meaning or is removed.
 */

import type { Difficulty, GamePhase, Role } from '../types';

/** Current replay schema version. Integer by design (see docs/replay-format.md). */
export const REPLAY_SCHEMA_VERSION = 1;

export type ReplayBoardId = '9-standard' | '12-standard';
export type ReplayLanguage = 'zh' | 'en';
export type ReplayWinner = 'VILLAGERS' | 'WEREWOLVES';

/** One seat of the finished match. Deliberately has no display name. */
export interface ReplayPlayerSeat {
  seat: number;
  role: Role;
  isHuman: boolean;
}

/** One entry of the ordered phase sequence (`LOBBY` is not captured). */
export interface ReplayPhaseEntry {
  phase: GamePhase;
  round: number;
}

/** One public daytime speech, including human speech verbatim. */
export interface ReplaySpeech {
  round: number;
  phase: GamePhase;
  speakerId: number;
  text: string;
}

/** One exile vote. `targetId: null` mirrors an abstention / lost vote. */
export interface ReplayVote {
  round: number;
  voterId: number;
  targetId: number | null;
  /** Present only when the AI action carried a reason. */
  reason?: string;
}

/** One `{ targetId, score }` pair read from the frozen belief tracker. */
export interface ReplayBeliefScore {
  targetId: number;
  score: number;
}

/**
 * Per-round suspicion snapshot for one living AI seat. `scores` is filtered to
 * the seats that were alive at capture time, so its length is `alive - 1`.
 */
export interface ReplayBeliefSnapshot {
  round: number;
  actorId: number;
  scores: ReplayBeliefScore[];
}

/** One werewolf night-chat message. */
export interface ReplayWolfChatEntry {
  round: number;
  speakerId: number;
  message: string;
}

/** One seer check, from either the AI seer or the human seer path. */
export interface ReplayCheck {
  round: number;
  actorId: number;
  targetId: number;
  isGood: boolean;
}

export interface ReplayOutcome {
  winner: ReplayWinner;
  rounds: number;
}

/** The complete, versioned replay payload. */
export interface ReplayRecord {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  gameId: string;
  createdAt: string;
  boardId: ReplayBoardId;
  difficulty: Difficulty;
  language: ReplayLanguage;
  isGuest: boolean;
  players: ReplayPlayerSeat[];
  phases: ReplayPhaseEntry[];
  speeches: ReplaySpeech[];
  votes: ReplayVote[];
  beliefSnapshots: ReplayBeliefSnapshot[];
  wolfChat: ReplayWolfChatEntry[];
  checks: ReplayCheck[];
  outcome: ReplayOutcome;
}

/** Input for the pure `buildReplay` / `createReplayRecorder` boundary. */
export interface ReplayDraft {
  gameId: string;
  createdAt?: string;
  boardId: ReplayBoardId;
  difficulty: Difficulty;
  language: ReplayLanguage;
  isGuest: boolean;
  players: readonly ReplayPlayerSeat[];
  phases: readonly ReplayPhaseEntry[];
  speeches: readonly ReplaySpeech[];
  votes: readonly ReplayVote[];
  beliefSnapshots: readonly ReplayBeliefSnapshot[];
  wolfChat: readonly ReplayWolfChatEntry[];
  checks: readonly ReplayCheck[];
  outcome: ReplayOutcome;
}

/** Identity + roster input for `createReplayRecorder`. */
export interface ReplayRecorderInput {
  /** Random local id; generated when omitted. Never an account id. */
  gameId?: string;
  /** ISO timestamp for the finished match; generated when omitted. */
  createdAt?: string;
  boardId: ReplayBoardId;
  difficulty: Difficulty;
  language: ReplayLanguage;
  isGuest: boolean;
  players: readonly ReplayPlayerSeat[];
}
