import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GamePhase, Role } from '../types';
import type {
  ReplayBeliefSnapshot,
  ReplayPlayerSeat,
  ReplayRecord,
  ReplayVote,
  ReplayWolfChatEntry,
} from '../replay/replayTypes';
import ReplayReview, { ReplayReviewPanel, formatSuspicionPercent } from './ReplayReview';

const countOf = (markup: string, value: string): number => markup.split(value).length - 1;

const ROLE_ORDER_9: Role[] = [
  Role.VILLAGER, Role.WEREWOLF, Role.SEER, Role.WITCH, Role.VILLAGER,
  Role.HUNTER, Role.WEREWOLF, Role.VILLAGER, Role.WEREWOLF,
];
const ROLE_ORDER_12: Role[] = [
  ...ROLE_ORDER_9, Role.VILLAGER, Role.WEREWOLF, Role.IDIOT,
];

const playersFor = (playerCount: 9 | 12): ReplayPlayerSeat[] => {
  const roles = playerCount === 9 ? ROLE_ORDER_9 : ROLE_ORDER_12;
  return roles.map((role, index) => ({
    seat: index + 1,
    role,
    isHuman: index === 0,
  }));
};

/** Deterministic belief scores for every AI actor and every other seat. */
const beliefSnapshotsFor = (playerCount: number, rounds: number[] = [1, 2, 3]): ReplayBeliefSnapshot[] => (
  rounds.flatMap(round => (
    Array.from({ length: playerCount }, (_, index) => index + 1)
      .filter(seat => seat !== 1)
      .map(actorId => ({
        round,
        actorId,
        scores: Array.from({ length: playerCount }, (_, index) => index + 1)
          .filter(targetId => targetId !== actorId)
          .map(targetId => ({
            targetId,
            score: ((actorId * 7 + targetId * 3 + round) % 10) / 10,
          })),
      }))
  ))
);

const votesFor = (playerCount: number): ReplayVote[] => [
  ...Array.from({ length: playerCount }, (_, index) => {
    const voterId = index + 1;
    const humanVote = voterId === 1;
    const targetId = voterId === playerCount ? null : (voterId % playerCount) + 1;
    return {
      round: 1,
      voterId,
      targetId,
      ...(humanVote ? {} : { reason: `Seat ${voterId} pushed the vote.` }),
    };
  }),
  ...Array.from({ length: playerCount - 1 }, (_, index) => ({
    round: 2,
    voterId: index + 2,
    targetId: index === 0 ? 1 : index + 1,
    reason: `Round two reason from seat ${index + 2}.`,
  })),
];

const wolfChatFor = (): ReplayWolfChatEntry[] => [
  { round: 1, speakerId: 2, message: 'Push the quiet seat before the vote.' },
  { round: 1, speakerId: 7, message: 'I will follow your vote.' },
  { round: 2, speakerId: 4, message: 'The seer check points at seat 9.' },
];

const makeReplay = (
  playerCount: 9 | 12,
  overrides: Partial<ReplayRecord> = {},
): ReplayRecord => ({
  schemaVersion: 1,
  gameId: `review-fixture-${playerCount}`,
  createdAt: '2026-11-12T09:30:00.000Z',
  boardId: playerCount === 9 ? '9-standard' : '12-standard',
  difficulty: 'normal',
  language: 'en',
  isGuest: true,
  players: playersFor(playerCount),
  phases: [
    { phase: GamePhase.NIGHT_START, round: 0 },
    { phase: GamePhase.DAY_DISCUSSION, round: 1 },
    { phase: GamePhase.GAME_OVER, round: 3 },
  ],
  speeches: [],
  votes: votesFor(playerCount),
  beliefSnapshots: beliefSnapshotsFor(playerCount),
  wolfChat: wolfChatFor(),
  checks: [],
  outcome: { winner: 'VILLAGERS', rounds: 3 },
  ...overrides,
});

const renderPanel = (replay: ReplayRecord): string => renderToStaticMarkup(
  <ReplayReview isGameOver replay={replay} initialOpen />,
);

describe('ReplayReview terminal gate', () => {
  it('renders no review root and no entry button before GAME_OVER', () => {
    const markup = renderToStaticMarkup(
      <ReplayReview isGameOver={false} replay={makeReplay(9)} initialOpen />,
    );

    expect(markup).toBe('');
    expect(markup).not.toContain('data-testid="replay-review"');
    expect(markup).not.toContain('Replay review');
  });

  it('keeps the review dialog closed by default while showing only the terminal entry', () => {
    const markup = renderToStaticMarkup(
      <ReplayReview isGameOver replay={makeReplay(9)} />,
    );

    expect(countOf(markup, 'data-testid="replay-review"')).toBe(1);
    expect(countOf(markup, 'data-testid="replay-review-open"')).toBe(1);
    expect(markup).toContain('Replay review');
    expect(markup).not.toContain('data-testid="replay-review-panel"');
    expect(markup).not.toContain('data-testid="replay-suspicion"');
  });
});

describe('ReplayReview 9-player panel', () => {
  const replay = makeReplay(9);
  const markup = renderPanel(replay);

  it('renders the three required blocks from replay data', () => {
    expect(markup).toContain('data-testid="replay-review-panel"');
    expect(markup).toContain('data-testid="replay-suspicion"');
    expect(markup).toContain('data-testid="replay-suspicion-chart"');
    expect(markup).toContain('data-testid="replay-votes"');
    expect(markup).toContain('data-testid="replay-wolf-chat"');
    expect(markup).toContain('9-Player Standard');
    expect(markup).toContain('Village Wins');
    expect(markup).toContain('Round 1');
  });

  it('draws one suspicion line per seat and highlights the human seat', () => {
    expect(countOf(markup, 'data-testid="replay-suspicion-line"')).toBe(9);
    expect(countOf(markup, 'data-human-seat="true"')).toBeGreaterThanOrEqual(1);
    expect(countOf(markup, 'data-testid="replay-suspicion-legend-item"')).toBe(9);
    expect(markup).toContain('Seat 1 (you) · AI avg');
    expect(markup).toContain('8 AI lines + your highlighted average');
    // A 9-seat chart, not a 12-seat one.
    expect(markup).toContain('data-seat="9"');
    expect(markup).not.toContain('data-seat="10"');
  });

  it('lists every vote row with round, voter, target and a reason or placeholder', () => {
    const rows = replay.votes.length;
    expect(rows).toBe(9 + 8);
    expect(countOf(markup, 'data-testid="replay-vote-row"')).toBe(rows);
    expect(countOf(markup, 'data-testid="replay-vote-round"')).toBe(2);
    expect(markup).toContain('data-testid="replay-vote-row" data-round="1" data-voter="1"');
    expect(markup).toContain('No reason recorded.');
    expect(markup).toContain('Seat 2 pushed the vote.');
    expect(markup).toContain('Abstained');
    expect(markup).not.toContain('undefined');
  });

  it('lists wild chat entries and the final ranking', () => {
    expect(countOf(markup, 'data-testid="replay-wolf-chat-row"')).toBe(3);
    expect(countOf(markup, 'data-testid="replay-wolf-chat-round"')).toBe(2);
    expect(markup).toContain('Push the quiet seat before the vote.');
    expect(markup).toContain('data-testid="replay-final-ranking"');
    expect(countOf(markup, 'data-testid="replay-final-ranking-row"')).toBe(9);
    expect(markup).toContain('data-testid="replay-human-rank"');
  });

  it('reserves the H2-E share slot at the bottom of the panel', () => {
    expect(markup).toContain('data-testid="replay-share-slot"');
    expect(markup.indexOf('data-testid="replay-wolf-chat"'))
      .toBeLessThan(markup.indexOf('data-testid="replay-share-slot"'));
    expect(markup.indexOf('data-testid="replay-local-note"'))
      .toBeLessThan(markup.indexOf('data-testid="replay-share-slot"'));
  });

  it('renders an accessible modal shell', () => {
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="Close replay review"');
    expect(markup).toContain('Suspicion curves, exile vote reasons, and werewolf night chat from the saved match.');
  });
});

describe('ReplayReview 12-player panel', () => {
  const markup = renderPanel(makeReplay(12));

  it('renders one line and one legend item per seat for the 12-player board', () => {
    expect(countOf(markup, 'data-testid="replay-suspicion-line"')).toBe(12);
    expect(countOf(markup, 'data-testid="replay-suspicion-legend-item"')).toBe(12);
    expect(countOf(markup, 'data-testid="replay-final-ranking-row"')).toBe(12);
    expect(markup).toContain('12-Player Standard');
    expect(markup).toContain('11 AI lines + your highlighted average');
    expect(markup).toContain('data-seat="12"');
  });

  it('counts every 12-player vote row', () => {
    expect(countOf(markup, 'data-testid="replay-vote-row"')).toBe(12 + 11);
  });
});

describe('ReplayReview degraded input', () => {
  it('shows the English replay-unavailable line instead of throwing', () => {
    const markup = renderToStaticMarkup(
      <ReplayReview isGameOver replay={null} initialOpen />,
    );

    expect(markup).toContain('Replay unavailable.');
    expect(markup).toContain('data-testid="replay-review-panel"');
    expect(markup).toContain('You can still return to the lobby.');
    expect(markup).not.toContain('data-testid="replay-suspicion"');
    expect(markup).not.toContain('undefined');
  });

  it('renders the rest of the panel when belief snapshots are missing', () => {
    const partial = makeReplay(9);
    delete (partial as Partial<ReplayRecord>).beliefSnapshots;

    const markup = renderPanel(partial);

    expect(markup).toContain('Suspicion data unavailable for this replay.');
    expect(markup).not.toContain('data-testid="replay-suspicion-chart"');
    expect(markup).toContain('data-testid="replay-votes"');
    expect(markup).toContain('data-testid="replay-share-slot"');
  });

  it('omits the wolf-chat block when a replay has no wolf chat', () => {
    const markup = renderPanel(makeReplay(9, { wolfChat: [] }));
    expect(markup).not.toContain('data-testid="replay-wolf-chat"');
    expect(markup).toContain('data-testid="replay-votes"');
  });

  it('renders the panel body in isolation for H2-E-style embedding', () => {
    const markup = renderToStaticMarkup(<ReplayReviewPanel replay={makeReplay(9)} />);
    expect(markup).toContain('data-testid="replay-review-panel"');
    expect(markup).toContain('data-testid="replay-share-slot"');
  });
});

describe('formatSuspicionPercent', () => {
  it('rounds 0-1 scores and keeps a placeholder for missing data', () => {
    expect(formatSuspicionPercent(0)).toBe('0%');
    expect(formatSuspicionPercent(0.456)).toBe('46%');
    expect(formatSuspicionPercent(1)).toBe('100%');
    expect(formatSuspicionPercent(null)).toBe('—');
  });
});
