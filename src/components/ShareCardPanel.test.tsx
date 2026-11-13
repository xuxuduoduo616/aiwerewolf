import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GamePhase, Role } from '../types';
import type {
  ReplayBeliefSnapshot,
  ReplayPlayerSeat,
  ReplayRecord,
  ReplayVote,
} from '../replay/replayTypes';
import ShareCardPanel from './ShareCardPanel';

const countOf = (markup: string, value: string): number => markup.split(value).length - 1;

const ROLE_ORDER_9: Role[] = [
  Role.VILLAGER, Role.WEREWOLF, Role.SEER, Role.WITCH, Role.VILLAGER,
  Role.HUNTER, Role.WEREWOLF, Role.VILLAGER, Role.WEREWOLF,
];
const ROLE_ORDER_12: Role[] = [...ROLE_ORDER_9, Role.VILLAGER, Role.WEREWOLF, Role.IDIOT];

const playersFor = (playerCount: 9 | 12): ReplayPlayerSeat[] => {
  const roles = playerCount === 9 ? ROLE_ORDER_9 : ROLE_ORDER_12;
  return roles.map((role, index) => ({ seat: index + 1, role, isHuman: index === 0 }));
};

const beliefSnapshotsFor = (playerCount: number): ReplayBeliefSnapshot[] => (
  [1, 2, 3].flatMap(round => (
    Array.from({ length: playerCount }, (_, index) => index + 1)
      .filter(actorId => actorId !== 1)
      .map(actorId => ({
        round,
        actorId,
        scores: Array.from({ length: playerCount }, (_, index) => index + 1)
          .filter(targetId => targetId !== actorId)
          .map(targetId => ({
            targetId,
            score: targetId === 1 ? 0.6 : targetId === 2 ? 0.9 : 0.2,
          })),
      }))
  ))
);

const LONG_REASON = `Long vote reason about the human seat. ${'More detail. '.repeat(30)}`;

const votesFor = (): ReplayVote[] => [
  { round: 1, voterId: 4, targetId: 1, reason: 'Seat 4 says the human seat dodged every question.' },
  { round: 2, voterId: 2, targetId: 1, reason: LONG_REASON },
];

const makeReplay = (
  playerCount: 9 | 12,
  overrides: Partial<ReplayRecord> = {},
): ReplayRecord => ({
  schemaVersion: 1,
  gameId: `panel-fixture-${playerCount}`,
  createdAt: '2026-11-12T09:30:00.000Z',
  boardId: playerCount === 9 ? '9-standard' : '12-standard',
  difficulty: 'normal',
  language: 'en',
  isGuest: true,
  players: playersFor(playerCount),
  phases: [
    { phase: GamePhase.NIGHT_START, round: 0 },
    { phase: GamePhase.GAME_OVER, round: 3 },
  ],
  speeches: [],
  votes: votesFor(),
  beliefSnapshots: beliefSnapshotsFor(playerCount),
  wolfChat: [{ round: 1, speakerId: 7, message: 'Wolf chat: keep the human seat under pressure.' }],
  checks: [],
  outcome: { winner: 'VILLAGERS', rounds: 3 },
  ...overrides,
});

const render = (replay: ReplayRecord): string => renderToStaticMarkup(
  <ShareCardPanel replay={replay} />,
);

describe('ShareCardPanel', () => {
  it('renders the 9-player preview, quotes and the export button', () => {
    const markup = render(makeReplay(9));

    expect(markup).toContain('data-testid="share-card-panel"');
    expect(markup).toContain('data-testid="share-card-preview"');
    expect(markup).toContain('data-file-name="ai-view-of-you-panel-fixture-9.png"');
    expect(markup).toContain('data-testid="share-card-seat"');
    expect(markup).toContain('Seat 1 · Villager');
    expect(markup).toContain('9-Player Standard · 3 rounds · Village Wins');

    expect(markup).toContain('data-testid="share-card-stat-average"');
    expect(markup).toContain('data-testid="share-card-stat-rank"');
    expect(markup).toContain('data-testid="share-card-stat-most-suspicious"');
    expect(markup).toContain('60%');
    expect(markup).toContain('#2 of 9');
    expect(markup).toContain('Seat 2 · 60%');
    expect(markup).not.toContain('final suspicion unavailable');

    expect(countOf(markup, 'data-testid="share-card-quote"')).toBe(3);
    expect(markup).toContain('Day 1 · Seat 4 voted for you');
    expect(markup).toContain('Night 1 · Seat 7 wolf chat');
    expect(markup).not.toContain('undefined');

    expect(markup).toContain('data-testid="share-card-export"');
    expect(markup).toContain('Export PNG');
    expect(markup).toContain('AI');
    expect(markup).toContain('view of you');
  });

  it('scales the rank denominator to the 12-player board', () => {
    const markup = render(makeReplay(12));

    expect(markup).toContain('12-Player Standard · 3 rounds · Village Wins');
    expect(markup).toContain('#2 of 12');
    expect(markup).toContain('Among 12 living seats');
    expect(markup).not.toContain('#2 of 9');
  });

  it('shows the unavailable line instead of fabricated suspicion values', () => {
    const markup = render(makeReplay(9, { beliefSnapshots: [] }));

    expect(markup).toContain('data-testid="share-card-suspicion-unavailable"');
    expect(markup).toContain('final suspicion unavailable');
    expect(markup).not.toContain('data-testid="share-card-stat-average"');
    expect(markup).not.toContain('60%');
    expect(markup).not.toContain('#2 of 9');
    // The export path and the rest of the card stay available.
    expect(markup).toContain('data-testid="share-card-export"');
    expect(markup).toContain('data-testid="share-card-quote"');
  });

  it('renders the truncated quote rather than the overlong source text', () => {
    const markup = render(makeReplay(9));

    expect(markup).toContain('…');
    expect(markup).not.toContain(LONG_REASON);
    expect(countOf(markup, 'data-testid="share-card-quote"')).toBe(3);
  });

  it('renders nothing when the match has no winner (defensive terminal gate)', () => {
    const replay = makeReplay(9);
    const noWinner = {
      ...replay,
      outcome: { ...replay.outcome, winner: null },
    } as unknown as ReplayRecord;

    const markup = render(noWinner);

    expect(markup).toBe('');
    expect(markup).not.toContain('data-testid="share-card-export"');
    expect(markup).not.toContain('data-testid="share-card-panel"');
  });

  it('renders the empty-quotes line when vote reasons and wolf chat are absent', () => {
    const markup = render(makeReplay(9, { votes: [], wolfChat: [] }));

    expect(markup).toContain('data-testid="share-card-quotes-empty"');
    expect(markup).toContain('No AI vote reasons or wolf chat were recorded for this match.');
    expect(countOf(markup, 'data-testid="share-card-quote"')).toBe(0);
  });
});
