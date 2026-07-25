import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { GamePhase } from '../types';
import type { VoteRecord } from '../types';
import VoteSummary, { computeVoteSummary } from './VoteSummary';

const responsiveCss = readFileSync(new URL('../styles/game-responsive.css', import.meta.url), 'utf8');

const vote = (round: number, voterId: number, targetId: number | null): VoteRecord => ({
  round,
  voterId,
  targetId,
  phase: GamePhase.DAY_VOTING,
});

describe('computeVoteSummary', () => {
  it('groups votes by target with counts and percentages — normal exile', () => {
    const records: VoteRecord[] = [
      vote(1, 1, 5),
      vote(1, 2, 5),
      vote(1, 3, 5),
      vote(1, 4, 1),
    ];

    const summary = computeVoteSummary(records, 1);

    expect(summary.totalVotes).toBe(4);
    expect(summary.groups[0].targetId).toBe(5);
    expect(summary.groups[0].count).toBe(3);
    expect(summary.groups[0].percent).toBe(75);
    expect(summary.groups[0].voterIds).toEqual([1, 2, 3]);
    expect(summary.groups[1].targetId).toBe(1);
    expect(summary.groups[1].count).toBe(1);
    expect(summary.abstainVoterIds).toEqual([]);
  });

  it('sorts groups by descending count — tie between players 3 and 5', () => {
    const records: VoteRecord[] = [
      vote(2, 1, 3),
      vote(2, 2, 3),
      vote(2, 4, 5),
      vote(2, 6, 5),
    ];

    const summary = computeVoteSummary(records, 2);

    expect(summary.totalVotes).toBe(4);
    expect(summary.groups).toHaveLength(2);
    expect(summary.groups[0].count).toBe(2);
    expect(summary.groups[1].count).toBe(2);
    // Both targets present; a null eliminatedPlayerId (tie) is decided by gameEngine
    const targetIds = summary.groups.map(g => g.targetId).sort((a, b) => a - b);
    expect(targetIds).toEqual([3, 5]);
  });

  it('separates abstentions (targetId === null)', () => {
    const records: VoteRecord[] = [
      vote(1, 1, 5),
      vote(1, 2, null),
      vote(1, 3, null),
      vote(1, 4, 5),
    ];

    const summary = computeVoteSummary(records, 1);

    expect(summary.totalVotes).toBe(4);
    expect(summary.abstainVoterIds).toEqual([2, 3]);
    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0].targetId).toBe(5);
    expect(summary.groups[0].count).toBe(2);
    expect(summary.groups[0].percent).toBe(50);
  });

  it('handles empty records gracefully', () => {
    const summary = computeVoteSummary([], 1);

    expect(summary.totalVotes).toBe(0);
    expect(summary.groups).toEqual([]);
    expect(summary.abstainVoterIds).toEqual([]);
    expect(summary.pairs).toEqual([]);
  });

  it('only includes votes for the requested round', () => {
    const records: VoteRecord[] = [
      vote(1, 1, 5),
      vote(2, 2, 3),
    ];

    const summary = computeVoteSummary(records, 2);

    expect(summary.totalVotes).toBe(1);
    expect(summary.groups[0].targetId).toBe(3);
  });
});

describe('VoteSummary target geometry', () => {
  it('renders Details with the 44px target contract', () => {
    const html = renderToStaticMarkup(React.createElement(VoteSummary, {
      voteRecords: [vote(1, 1, 2)],
      players: [],
      round: 1,
      eliminatedPlayerId: 2,
    }));

    expect(html).toContain('class="game-vote-details-button');
    expect(html).toContain('aria-controls="vote-detail-panel"');
    expect(responsiveCss).toMatch(/\.game-vote-details-button\s*\{[\s\S]*?min-height:\s*44px;/);
  });
});
