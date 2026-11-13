/**
 * H2-B: pure projections from a finished `ReplayRecord` to review UI data.
 *
 * The functions in this module are read-only: they never touch storage, the
 * DOM, the network, `Date` or `Math.random`. The same replay always produces
 * deep-equal results, and malformed/partial replays degrade to empty
 * projections instead of throwing.
 *
 * Semantics used by the review panel:
 * - `buildSuspicionSeries` plots, for every AI seat, that AI's suspicion of the
 *   human seat per round. The human seat's own line is the highlighted average
 *   across those AI seats (the "how much did the table suspect me" curve), so a
 *   9-player game yields one line per seat (9) and a 12-player game yields 12.
 * - Scores come from `beliefSnapshots` only. A missing score for a round (e.g.
 *   the human was already dead, so the tracker omitted that target) creates a
 *   gap in that seat's curve rather than a fabricated zero.
 */

import type {
  ReplayBeliefScore,
  ReplayBeliefSnapshot,
  ReplayPlayerSeat,
  ReplayRecord,
  ReplayVote,
  ReplayWolfChatEntry,
} from './replayTypes';

export const SUSPICION_LEVELS = [0, 0.25, 0.5, 0.75, 1] as const;
export const VOTE_REASON_PLACEHOLDER = 'No reason recorded.';
export const ABSTAIN_TARGET_LABEL = 'Abstained';

/** Deterministic, high-contrast line colors for up to twelve seats. */
const SUSPICION_PALETTE = [
  '#f87171', '#fb923c', '#facc15', '#a3e635', '#34d399', '#22d3ee',
  '#60a5fa', '#a78bfa', '#f472b6', '#e879f9', '#fda4af', '#fde68a',
] as const;

/** Color for one AI seat's suspicion line; stable for a given seat. */
export const suspicionLineColor = (seat: number): string => {
  if (!Number.isFinite(seat)) return SUSPICION_PALETTE[0];
  const index = Math.abs(Math.trunc(seat) - 1) % SUSPICION_PALETTE.length;
  return SUSPICION_PALETTE[index];
};

export interface ReplaySuspicionPoint {
  round: number;
  score: number;
}

export interface ReplaySuspicionLine {
  seat: number;
  /** True for the human seat line: the highlighted AI average toward the human. */
  isHumanSeat: boolean;
  color: string;
  points: ReplaySuspicionPoint[];
  latest: number | null;
}

export interface ReplaySuspicionSeries {
  humanSeat: number;
  /** Sorted rounds that carry at least one belief snapshot. */
  rounds: number[];
  /** One line per roster seat; the human seat is the highlighted aggregate. */
  lines: ReplaySuspicionLine[];
  hasData: boolean;
}

export interface ReplayVoteReasonRow {
  round: number;
  voterId: number;
  targetId: number | null;
  /** Display string; never empty and never `undefined`. */
  reason: string;
  hasReason: boolean;
  isAbstain: boolean;
}

export interface ReplayVoteReasonGroup {
  round: number;
  rows: ReplayVoteReasonRow[];
}

export interface ReplayWolfChatRow {
  round: number;
  speakerId: number;
  message: string;
}

export interface ReplayWolfChatGroup {
  round: number;
  rows: ReplayWolfChatRow[];
}

export interface ReplayFinalSuspicionEntry {
  seat: number;
  averageScore: number;
  rank: number;
  isHumanSeat: boolean;
}

export interface ReplayFinalSuspicionRanking {
  /** Latest round that has belief snapshots. */
  round: number;
  entries: ReplayFinalSuspicionEntry[];
  humanRank: number | null;
  /** Mean of the AI scores aimed at the human seat in the final snapshot round. */
  averageSuspicionOfHuman: number | null;
  mostSuspiciousActor: { seat: number; score: number } | null;
}

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord | null => (
  value && typeof value === 'object' ? value as UnknownRecord : null
);

const toSeat = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const seat = Math.trunc(value);
  return seat > 0 ? seat : null;
};

/** Review projections accept round 0 (defensive: the recorder clamps to >= 1). */
const toRound = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const round = Math.trunc(value);
  return round >= 0 ? round : null;
};

const toScore = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
};

const readPlayers = (replay: ReplayRecord | null | undefined): ReplayPlayerSeat[] => {
  const raw = replay?.players;
  if (!Array.isArray(raw)) return [];
  const bySeat = new Map<number, ReplayPlayerSeat>();
  for (const value of raw) {
    const player = asRecord(value);
    if (!player) continue;
    const seat = toSeat(player.seat);
    if (seat === null || bySeat.has(seat)) continue;
    bySeat.set(seat, {
      seat,
      role: player.role as ReplayPlayerSeat['role'],
      isHuman: player.isHuman === true,
    });
  }
  return [...bySeat.values()].sort((a, b) => a.seat - b.seat);
};

const readSnapshots = (replay: ReplayRecord | null | undefined): ReplayBeliefSnapshot[] => {
  const raw = replay?.beliefSnapshots;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const snapshots: ReplayBeliefSnapshot[] = [];
  for (const value of raw) {
    const snapshot = asRecord(value);
    if (!snapshot) continue;
    const round = toRound(snapshot.round);
    const actorId = toSeat(snapshot.actorId);
    if (round === null || actorId === null) continue;
    const key = `${round}:${actorId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const scores: ReplayBeliefScore[] = [];
    if (Array.isArray(snapshot.scores)) {
      for (const entryValue of snapshot.scores) {
        const entry = asRecord(entryValue);
        if (!entry) continue;
        const targetId = toSeat(entry.targetId);
        const score = toScore(entry.score);
        if (targetId === null || score === null) continue;
        scores.push({ targetId, score });
      }
    }
    snapshots.push({ round, actorId, scores });
  }
  return snapshots;
};

const scoreMapFor = (snapshots: readonly ReplayBeliefSnapshot[]): Map<string, Map<number, number>> => {
  const map = new Map<string, Map<number, number>>();
  for (const snapshot of snapshots) {
    const scores = new Map<number, number>();
    for (const entry of snapshot.scores) scores.set(entry.targetId, entry.score);
    map.set(`${snapshot.round}:${snapshot.actorId}`, scores);
  }
  return map;
};

const humanSeatOf = (players: readonly ReplayPlayerSeat[]): number => (
  players.find(player => player.isHuman)?.seat ?? 1
);

const average = (values: readonly number[]): number => (
  values.reduce((total, value) => total + value, 0) / values.length
);

/**
 * Per-round suspicion toward the human seat. One line per roster seat: AI
 * seats plot their own suspicion of the human, the human seat plots the
 * highlighted average of those AI lines.
 */
export const buildSuspicionSeries = (
  replay: ReplayRecord | null | undefined,
): ReplaySuspicionSeries => {
  const players = readPlayers(replay);
  const humanSeat = humanSeatOf(players);
  const snapshots = readSnapshots(replay);
  const rounds = [...new Set(snapshots.map(snapshot => snapshot.round))].sort((a, b) => a - b);
  const scoreMap = scoreMapFor(snapshots);

  const aiLines = players
    .filter(player => player.seat !== humanSeat)
    .map(player => {
      const points: ReplaySuspicionPoint[] = [];
      for (const round of rounds) {
        const score = scoreMap.get(`${round}:${player.seat}`)?.get(humanSeat);
        if (score !== undefined) points.push({ round, score });
      }
      return { seat: player.seat, color: suspicionLineColor(player.seat), points };
    });

  const humanPoints: ReplaySuspicionPoint[] = [];
  for (const round of rounds) {
    const scores: number[] = [];
    for (const line of aiLines) {
      const point = line.points.find(item => item.round === round);
      if (point) scores.push(point.score);
    }
    if (scores.length > 0) humanPoints.push({ round, score: average(scores) });
  }

  const lines: ReplaySuspicionLine[] = players.map(player => {
    if (player.seat === humanSeat) {
      return {
        seat: humanSeat,
        isHumanSeat: true,
        color: '#f4f4f5',
        points: humanPoints,
        latest: humanPoints.length > 0 ? humanPoints[humanPoints.length - 1].score : null,
      };
    }
    const aiLine = aiLines.find(line => line.seat === player.seat);
    const points = aiLine?.points ?? [];
    return {
      seat: player.seat,
      isHumanSeat: false,
      color: aiLine?.color ?? suspicionLineColor(player.seat),
      points,
      latest: points.length > 0 ? points[points.length - 1].score : null,
    };
  });

  return {
    humanSeat,
    rounds,
    lines,
    hasData: rounds.length > 0 && lines.some(line => line.points.length > 0),
  };
};

/**
 * Latest-round suspicion ranking across every target the tracker scored that
 * round. The human's rank and the average suspicion aimed at the human are the
 * values `H2-E` reuses for the share card. `null` when no snapshot exists.
 */
export const buildFinalSuspicionRanking = (
  replay: ReplayRecord | null | undefined,
): ReplayFinalSuspicionRanking | null => {
  const players = readPlayers(replay);
  const humanSeat = humanSeatOf(players);
  const snapshots = readSnapshots(replay);
  if (snapshots.length === 0) return null;

  const round = Math.max(...snapshots.map(snapshot => snapshot.round));
  const roundSnapshots = snapshots.filter(snapshot => snapshot.round === round);
  const totals = new Map<number, { sum: number; count: number }>();
  let mostSuspiciousActor: { seat: number; score: number } | null = null;

  for (const snapshot of roundSnapshots) {
    for (const entry of snapshot.scores) {
      const current = totals.get(entry.targetId) ?? { sum: 0, count: 0 };
      current.sum += entry.score;
      current.count += 1;
      totals.set(entry.targetId, current);
      if (entry.targetId === humanSeat) {
        if (
          mostSuspiciousActor === null
          || entry.score > mostSuspiciousActor.score
          || (entry.score === mostSuspiciousActor.score && snapshot.actorId < mostSuspiciousActor.seat)
        ) {
          mostSuspiciousActor = { seat: snapshot.actorId, score: entry.score };
        }
      }
    }
  }

  const entries: ReplayFinalSuspicionEntry[] = [...totals.entries()]
    .map(([seat, total]) => ({
      seat,
      averageScore: total.sum / total.count,
      isHumanSeat: seat === humanSeat,
    }))
    .sort((a, b) => (b.averageScore - a.averageScore) || (a.seat - b.seat))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const human = entries.find(entry => entry.isHumanSeat);
  return {
    round,
    entries,
    humanRank: human?.rank ?? null,
    averageSuspicionOfHuman: human?.averageScore ?? null,
    mostSuspiciousActor,
  };
};

/** Vote reasons grouped by round; empty/absent reasons become a placeholder. */
export const buildVoteReasonGroups = (
  replay: ReplayRecord | null | undefined,
): ReplayVoteReasonGroup[] => {
  const raw = replay?.votes;
  if (!Array.isArray(raw)) return [];
  const byRound = new Map<number, ReplayVoteReasonRow[]>();

  for (const value of raw) {
    const vote = value as ReplayVote | null;
    if (!vote || typeof vote !== 'object') continue;
    const round = toRound(vote.round);
    const voterId = toSeat(vote.voterId);
    if (round === null || voterId === null) continue;
    let targetId: number | null = null;
    if (vote.targetId !== null && vote.targetId !== undefined) {
      targetId = toSeat(vote.targetId);
      if (targetId === null) continue;
    }
    const trimmed = typeof vote.reason === 'string' ? vote.reason.trim() : '';
    const hasReason = trimmed.length > 0;
    const row: ReplayVoteReasonRow = {
      round,
      voterId,
      targetId,
      reason: hasReason ? trimmed : VOTE_REASON_PLACEHOLDER,
      hasReason,
      isAbstain: targetId === null,
    };
    const rows = byRound.get(round) ?? [];
    rows.push(row);
    byRound.set(round, rows);
  }

  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, rows]) => ({ round, rows }));
};

/** Wolf night chat grouped by round; blank messages are dropped. */
export const buildWolfChatGroups = (
  replay: ReplayRecord | null | undefined,
): ReplayWolfChatGroup[] => {
  const raw = replay?.wolfChat;
  if (!Array.isArray(raw)) return [];
  const byRound = new Map<number, ReplayWolfChatRow[]>();

  for (const value of raw) {
    const entry = value as ReplayWolfChatEntry | null;
    if (!entry || typeof entry !== 'object') continue;
    const round = toRound(entry.round);
    const speakerId = toSeat(entry.speakerId);
    const message = typeof entry.message === 'string' ? entry.message.trim() : '';
    if (round === null || speakerId === null || message.length === 0) continue;
    const rows = byRound.get(round) ?? [];
    rows.push({ round, speakerId, message });
    byRound.set(round, rows);
  }

  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, rows]) => ({ round, rows }));
};
