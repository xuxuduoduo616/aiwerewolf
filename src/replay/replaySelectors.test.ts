import { describe, expect, it } from 'vitest';
import { GamePhase, Role } from '../types';
import type {
  ReplayBeliefSnapshot,
  ReplayPlayerSeat,
  ReplayRecord,
  ReplayVote,
  ReplayWolfChatEntry,
} from './replayTypes';
import {
  ABSTAIN_TARGET_LABEL,
  VOTE_REASON_PLACEHOLDER,
  buildFinalSuspicionRanking,
  buildSuspicionSeries,
  buildVoteReasonGroups,
  buildWolfChatGroups,
  suspicionLineColor,
} from './replaySelectors';

const seat = (value: number, role: Role, isHuman = false): ReplayPlayerSeat => ({
  seat: value,
  role,
  isHuman,
});

const ninePlayers = (): ReplayPlayerSeat[] => [
  seat(1, Role.VILLAGER, true),
  seat(2, Role.WEREWOLF),
  seat(3, Role.SEER),
  seat(4, Role.WITCH),
  seat(5, Role.VILLAGER),
  seat(6, Role.HUNTER),
  seat(7, Role.WEREWOLF),
  seat(8, Role.VILLAGER),
  seat(9, Role.WEREWOLF),
];

const twelvePlayers = (): ReplayPlayerSeat[] => [
  ...ninePlayers(),
  seat(10, Role.VILLAGER),
  seat(11, Role.WEREWOLF),
  seat(12, Role.IDIOT),
];

const snapshot = (round: number, actorId: number, scores: [number, number][]): ReplayBeliefSnapshot => ({
  round,
  actorId,
  scores: scores.map(([targetId, score]) => ({ targetId, score })),
});

const replay = (overrides: Partial<ReplayRecord> = {}): ReplayRecord => ({
  schemaVersion: 1,
  gameId: 'selector-fixture',
  createdAt: '2026-11-12T09:30:00.000Z',
  boardId: '9-standard',
  difficulty: 'normal',
  language: 'en',
  isGuest: true,
  players: ninePlayers(),
  phases: [
    { phase: GamePhase.NIGHT_START, round: 0 },
    { phase: GamePhase.DAY_DISCUSSION, round: 1 },
    { phase: GamePhase.GAME_OVER, round: 3 },
  ],
  speeches: [],
  votes: [],
  beliefSnapshots: [],
  wolfChat: [],
  checks: [],
  outcome: { winner: 'VILLAGERS', rounds: 3 },
  ...overrides,
});

/** Eight AI seats, each scoring the human seat, for three rounds. */
const ninePlayerSnapshots = (): ReplayBeliefSnapshot[] => {
  const scores: ReplayBeliefSnapshot[] = [];
  for (const round of [1, 2, 3]) {
    for (const actorId of [2, 3, 4, 5, 6, 7, 8, 9]) {
      scores.push(snapshot(round, actorId, [
        [1, 0.1 * (actorId - 1) + 0.1 * round],
        [2, 0.4],
        [3, 0.3],
      ]));
    }
  }
  return scores;
};

describe('buildSuspicionSeries', () => {
  it('plots one line per seat for a 9-player replay and highlights the human aggregate', () => {
    const series = buildSuspicionSeries(replay({ beliefSnapshots: ninePlayerSnapshots() }));

    expect(series.humanSeat).toBe(1);
    expect(series.rounds).toEqual([1, 2, 3]);
    expect(series.lines).toHaveLength(9);
    expect(series.lines.map(line => line.seat)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(series.hasData).toBe(true);

    const humanLine = series.lines[0];
    expect(humanLine.isHumanSeat).toBe(true);
    expect(humanLine.color).toBe('#f4f4f5');
    expect(humanLine.points.map(point => point.round)).toEqual([1, 2, 3]);
    // Round 1 AI scores toward seat 1 are 0.2 .. 0.9 (step 0.1); mean = 0.55.
    expect(humanLine.points[0].score).toBeCloseTo(0.55, 10);
    expect(humanLine.latest).toBeCloseTo(0.7375, 10);

    const aiSeats = series.lines.filter(line => !line.isHumanSeat);
    expect(aiSeats).toHaveLength(8);
    expect(aiSeats.every(line => line.points.length === 3)).toBe(true);
    expect(aiSeats[0].points[0]).toEqual({ round: 1, score: 0.2 });
    expect(aiSeats.at(-1)?.points.at(-1)).toEqual({ round: 3, score: 1 });
    expect(new Set(aiSeats.map(line => line.color)).size).toBe(8);
  });

  it('plots one line per seat for a 12-player replay', () => {
    const players = twelvePlayers();
    const snapshots: ReplayBeliefSnapshot[] = [1, 2].flatMap(round => (
      players
        .filter(player => !player.isHuman)
        .map(player => snapshot(round, player.seat, [[1, 0.5], [2, 0.2]]))
    ));

    const series = buildSuspicionSeries(replay({
      boardId: '12-standard',
      players,
      beliefSnapshots: snapshots,
      outcome: { winner: 'WEREWOLVES', rounds: 2 },
    }));

    expect(series.lines).toHaveLength(12);
    expect(series.lines.filter(line => line.isHumanSeat)).toHaveLength(1);
    expect(series.lines.filter(line => !line.isHumanSeat)).toHaveLength(11);
    expect(series.lines.every(line => line.points.length === 2)).toBe(true);
  });

  it('returns empty projections without throwing when snapshots are missing', () => {
    const withoutSnapshots = replay();
    delete (withoutSnapshots as Partial<ReplayRecord>).beliefSnapshots;

    const series = buildSuspicionSeries(withoutSnapshots);

    expect(series.rounds).toEqual([]);
    expect(series.hasData).toBe(false);
    expect(series.lines).toHaveLength(9);
    expect(series.lines.every(line => line.points.length === 0 && line.latest === null)).toBe(true);
  });

  it('handles an empty or null replay', () => {
    const empty = buildSuspicionSeries(null);
    expect(empty).toEqual({ humanSeat: 1, rounds: [], lines: [], hasData: false });

    const partial = buildSuspicionSeries({} as ReplayRecord);
    expect(partial.lines).toEqual([]);
    expect(partial.hasData).toBe(false);
  });

  it('accepts round 0 and a single-round replay, clamps scores and drops invalid values', () => {
    const single = buildSuspicionSeries(replay({
      players: [seat(1, Role.VILLAGER, true), seat(2, Role.WEREWOLF)],
      beliefSnapshots: [snapshot(0, 2, [[1, 1.7]])],
      outcome: { winner: 'WEREWOLVES', rounds: 1 },
    }));

    expect(single.rounds).toEqual([0]);
    expect(single.lines).toHaveLength(2);
    expect(single.lines[1].points).toEqual([{ round: 0, score: 1 }]);
    expect(single.lines[0].points).toEqual([{ round: 0, score: 1 }]);

    const messy = buildSuspicionSeries(replay({
      beliefSnapshots: [
        snapshot(1, 2, [[1, 0.4]]),
        { round: 1, actorId: 3, scores: [{ targetId: 1, score: Number.NaN }, { targetId: 1, score: 0.4 }] },
        { round: Number.NaN, actorId: 2, scores: [] } as unknown as ReplayBeliefSnapshot,
        { round: 2, actorId: 0, scores: [] } as unknown as ReplayBeliefSnapshot,
      ],
      players: [seat(1, Role.VILLAGER, true), seat(2, Role.WEREWOLF), seat(3, Role.SEER)],
    }));

    expect(messy.rounds).toEqual([1]);
    expect(messy.lines[1].points).toEqual([{ round: 1, score: 0.4 }]);
    expect(messy.lines[2].points).toEqual([{ round: 1, score: 0.4 }]);
  });

  it('is deterministic and does not mutate the input', () => {
    const input = replay({ beliefSnapshots: ninePlayerSnapshots() });
    const before = JSON.stringify(input);

    const first = buildSuspicionSeries(input);
    const second = buildSuspicionSeries(input);

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('buildFinalSuspicionRanking', () => {
  it('ranks the latest round by average suspicion and exposes the human rank', () => {
    const ranking = buildFinalSuspicionRanking(replay({
      players: [
        seat(1, Role.VILLAGER, true),
        seat(2, Role.WEREWOLF),
        seat(3, Role.SEER),
        seat(4, Role.VILLAGER),
      ],
      beliefSnapshots: [
        snapshot(1, 2, [[1, 0.2]]),
        snapshot(3, 2, [[1, 0.9], [3, 0.4], [4, 0.1]]),
        snapshot(3, 3, [[1, 0.7], [2, 0.6], [4, 0.2]]),
        snapshot(3, 4, [[1, 0.5], [2, 0.3], [3, 0.1]]),
      ],
    }));

    expect(ranking).not.toBeNull();
    expect(ranking?.round).toBe(3);
    expect(ranking?.entries.map(entry => entry.seat)).toEqual([1, 2, 3, 4]);
    expect(ranking?.entries.map(entry => entry.rank)).toEqual([1, 2, 3, 4]);
    expect(ranking?.entries[0].averageScore).toBeCloseTo(0.7, 10);
    expect(ranking?.humanRank).toBe(1);
    expect(ranking?.averageSuspicionOfHuman).toBeCloseTo(0.7, 10);
    expect(ranking?.mostSuspiciousActor).toEqual({ seat: 2, score: 0.9 });
  });

  it('returns null human values when the human was not scored in the final round', () => {
    const ranking = buildFinalSuspicionRanking(replay({
      beliefSnapshots: [
        snapshot(1, 2, [[1, 0.9]]),
        snapshot(2, 2, [[3, 0.6], [4, 0.2]]),
        snapshot(2, 3, [[2, 0.4]]),
      ],
    }));

    expect(ranking?.round).toBe(2);
    expect(ranking?.humanRank).toBeNull();
    expect(ranking?.averageSuspicionOfHuman).toBeNull();
    expect(ranking?.mostSuspiciousActor).toBeNull();
    expect(ranking?.entries.map(entry => entry.seat)).toEqual([3, 2, 4]);
  });

  it('returns null for a replay without snapshots', () => {
    expect(buildFinalSuspicionRanking(null)).toBeNull();
    expect(buildFinalSuspicionRanking(replay())).toBeNull();
  });
});

describe('buildVoteReasonGroups', () => {
  const vote = (value: Partial<ReplayVote>): ReplayVote => ({
    round: 1,
    voterId: 1,
    targetId: 2,
    ...value,
  });

  it('groups votes by round, sorted, with placeholders instead of undefined reasons', () => {
    const groups = buildVoteReasonGroups(replay({
      votes: [
        vote({ round: 2, voterId: 3, targetId: null }),
        vote({ round: 1, voterId: 1, targetId: 2 }),
        vote({ round: 1, voterId: 2, targetId: 4, reason: '  Seat 1 is deflecting.  ' }),
        vote({ round: 1, voterId: 4, targetId: 1, reason: '   ' }),
      ],
    }));

    expect(groups.map(group => group.round)).toEqual([1, 2]);
    expect(groups[0].rows).toHaveLength(3);
    expect(groups[0].rows[0]).toMatchObject({
      round: 1,
      voterId: 1,
      targetId: 2,
      reason: VOTE_REASON_PLACEHOLDER,
      hasReason: false,
      isAbstain: false,
    });
    expect(groups[0].rows[1].reason).toBe('Seat 1 is deflecting.');
    expect(groups[0].rows[2].reason).toBe(VOTE_REASON_PLACEHOLDER);
    expect(groups[1].rows[0]).toMatchObject({
      targetId: null,
      isAbstain: true,
      reason: VOTE_REASON_PLACEHOLDER,
    });
    expect(ABSTAIN_TARGET_LABEL).toBe('Abstained');
    expect(groups.every(group => group.rows.every(row => typeof row.reason === 'string' && row.reason.length > 0))).toBe(true);
  });

  it('handles empty, missing and malformed vote arrays', () => {
    expect(buildVoteReasonGroups(null)).toEqual([]);
    expect(buildVoteReasonGroups(replay())).toEqual([]);

    const groups = buildVoteReasonGroups(replay({
      votes: [
        { round: Number.NaN, voterId: 2, targetId: 3 },
        { round: 1, voterId: 0, targetId: 3 },
        { round: 1, voterId: 2, targetId: -1 },
        { round: 1, voterId: 2, targetId: 3 },
      ] as unknown as ReplayVote[],
    }));

    expect(groups).toEqual([{
      round: 1,
      rows: [{
        round: 1,
        voterId: 2,
        targetId: 3,
        reason: VOTE_REASON_PLACEHOLDER,
        hasReason: false,
        isAbstain: false,
      }],
    }]);
  });

  it('is deterministic for the same votes', () => {
    const input = replay({ votes: [vote({ reason: 'Repeatable' })] });
    expect(buildVoteReasonGroups(input)).toEqual(buildVoteReasonGroups(input));
  });
});

describe('buildWolfChatGroups', () => {
  const chat = (value: Partial<ReplayWolfChatEntry>): ReplayWolfChatEntry => ({
    round: 1,
    speakerId: 2,
    message: 'Push the seer claim.',
    ...value,
  });

  it('groups night chat by round and drops blank messages', () => {
    const groups = buildWolfChatGroups(replay({
      wolfChat: [
        chat({ round: 2, speakerId: 4, message: 'Kill seat 3.' }),
        chat({ round: 1, speakerId: 2 }),
        chat({ round: 1, speakerId: 3, message: '   ' }),
        chat({ round: 1, speakerId: 5, message: '  Follow seat 2.  ' }),
      ],
    }));

    expect(groups.map(group => group.round)).toEqual([1, 2]);
    expect(groups[0].rows).toEqual([
      { round: 1, speakerId: 2, message: 'Push the seer claim.' },
      { round: 1, speakerId: 5, message: 'Follow seat 2.' },
    ]);
    expect(groups[1].rows).toHaveLength(1);
  });

  it('returns no groups when the replay has no wolf chat', () => {
    expect(buildWolfChatGroups(null)).toEqual([]);
    expect(buildWolfChatGroups(replay())).toEqual([]);
    expect(buildWolfChatGroups(replay({
      wolfChat: [
        chat({ message: '' }),
        { round: 1, speakerId: 0, message: 'hi' } as unknown as ReplayWolfChatEntry,
      ],
    }))).toEqual([]);
  });
});

describe('suspicionLineColor', () => {
  it('is stable per seat and always returns a CSS color', () => {
    expect(suspicionLineColor(2)).toBe(suspicionLineColor(2));
    expect(suspicionLineColor(2)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(suspicionLineColor(Number.NaN)).toBe(suspicionLineColor(1));
    expect(new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(suspicionLineColor)).size).toBe(11);
  });
});
