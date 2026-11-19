import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GamePhase, type GameLog } from '../types';
import GameLogDialog, { GameLogFeed } from './GameLogDialog';

const feedProps = {
  logs: [{
    id: 'log-1',
    phase: GamePhase.DAY_ANNOUNCE,
    message: 'Day begins',
    translation: '白天开始',
    isSystem: true,
  }],
  language: 'en' as const,
  showVoteSummary: false,
  voteRound: null,
  voteRecords: [],
  players: [],
  eliminatedPlayerId: null,
  isProcessingAI: false,
};

describe('GameLogDialog', () => {
  it('renders a named modal with named log and records tabs', () => {
    const markup = renderToStaticMarkup(
      <GameLogDialog
        open
        onClose={vi.fn()}
        returnFocusRef={{ current: null }}
        records={[]}
        {...feedProps}
      />,
    );

    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('Game information');
    expect(markup).toContain('aria-label="Close game information"');
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Game information views"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('Game log');
    expect(markup).toContain('My records');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toMatch(/aria-controls="game-log-panel-[^"]+"/);
    expect(markup).toMatch(/aria-labelledby="game-log-tab-[^"]+"/);
    expect(markup).toContain('Day begins');
  });

  it('keeps the reusable log feed observable while AI is processing', () => {
    const markup = renderToStaticMarkup(
      <GameLogFeed {...feedProps} isProcessingAI />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('AI is considering the situation...');
    expect(markup).toContain('Day begins');
  });

  it('does not render while closed', () => {
    const markup = renderToStaticMarkup(
      <GameLogDialog
        open={false}
        onClose={vi.fn()}
        returnFocusRef={{ current: null }}
        records={[]}
        {...feedProps}
      />,
    );

    expect(markup).toBe('');
  });

  it('keeps private wolf entries out of non-wolf feeds and preserves chronological names and full text for wolves', () => {
    const text = 'We will keep our stories independent. Player 3 will lead the push while I cover the claim.';
    const logs: GameLog[] = [feedProps.logs[0], { id: 'private', phase: GamePhase.NIGHT_WEREWOLVES, message: text, speakerId: 3, isSystem: false, tone: 'wolf' }, { ...feedProps.logs[0], id: 'last', message: 'Dawn arrives.' }];
    const hidden = renderToStaticMarkup(<GameLogFeed {...feedProps} logs={logs} />);
    expect(hidden).not.toContain(text);
    const visible = renderToStaticMarkup(<GameLogFeed {...feedProps} logs={logs} canViewWolfChat players={[{ id: 3, name: 'Elena', role: 'Werewolf', camp: 'WEREWOLF', isHuman: false, isAlive: true, canVote: true, isRevealed: false, avatarUrl: '', aiPersonality: '', traits: [], aiModelLabel: '', publicClaims: [], privateKnowledge: [], suspicionMap: {} } as import('../types').Player]} />);
    expect(visible).toContain(text);
    expect(visible).toContain('Player 3 · Elena · Private');
    expect(visible).toContain('bg-red-950/35');
    expect(visible.indexOf('Day begins')).toBeLessThan(visible.indexOf(text));
    expect(visible.indexOf(text)).toBeLessThan(visible.indexOf('Dawn arrives.'));
  });
});
