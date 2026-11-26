import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import { GamePhase, Role, type Player } from '../types';
import ActionBar, { actionLabel, canHumanWitchSave, type ActionLabelKey } from './ActionBar';

// Owner-specified label table (task card action-bar-i18n).
const EXPECTED: Record<ActionLabelKey, string> = {
  KILL: 'KILL',
  CHECK: 'CHECK',
  SAVE: 'SAVE',
  POISON: 'POISON',
  PASS: 'PASS',
  SHOOT: 'SHOOT',
  VOTE: 'VOTE',
  NO_VOTE: 'NO VOTE',
};

const KEYS = Object.keys(EXPECTED) as ActionLabelKey[];

const witchPlayer: Player = {
  id: 1,
  name: 'Human',
  role: Role.WITCH,
  camp: 'VILLAGE',
  isAlive: true,
  canVote: true,
  isRevealed: false,
  avatarUrl: '',
  aiPersonality: 'Human',
  traits: [],
  aiModelLabel: 'HUMAN',
  isHuman: true,
  publicClaims: [],
  privateKnowledge: [],
  suspicionMap: {},
};

const saveButtonDisabled = (roundCount: number, wolfKillId: number | null, hasSave = true): boolean => {
  const html = renderToStaticMarkup(
    React.createElement(ActionBar, {
      phase: GamePhase.NIGHT_WITCH,
      me: witchPlayer,
      isProcessingAI: false,
      witchStatus: { hasSave, hasPoison: true },
      nightState: { wolfKillId, witchPoisonId: null, witchSaved: false },
      roundCount,
      onAction: () => {},
      onVoteSkip: () => {},
      onWitchSave: () => {},
      onWitchSkip: () => {},
    }),
  );
  const saveMatch = html.match(/<button[^>]*>.*?SAVE<\/button>/);
  expect(saveMatch).not.toBeNull();
  return /\bdisabled\b/.test(saveMatch![0]);
};

describe('ActionBar actionLabel', () => {
  it('covers all eight action keys', () => {
    expect(KEYS).toHaveLength(8);
  });

  it.each(KEYS)('renders the English label for %s when stored language is zh', key => {
    expect(actionLabel(key, 'zh')).toBe(EXPECTED[key]);
  });

  it.each(KEYS)('renders the English label for %s when language is en', key => {
    expect(actionLabel(key, 'en')).toBe(EXPECTED[key]);
  });
});

describe('ActionBar Witch Night-1-only self-save rule', () => {
  it('enables SAVE on Night 1 when Witch is targeted (self-save allowed)', () => {
    expect(
      canHumanWitchSave({
        me: witchPlayer,
        witchStatus: { hasSave: true, hasPoison: true },
        nightState: { wolfKillId: 1 },
        roundCount: 1,
      }),
    ).toBe(true);
    expect(saveButtonDisabled(1, 1, true)).toBe(false);
  });

  it('disables SAVE on Night 2+ when Witch is targeted (self-save forbidden)', () => {
    expect(
      canHumanWitchSave({
        me: witchPlayer,
        witchStatus: { hasSave: true, hasPoison: true },
        nightState: { wolfKillId: 1 },
        roundCount: 2,
      }),
    ).toBe(false);
    expect(saveButtonDisabled(2, 1, true)).toBe(true);
    expect(saveButtonDisabled(3, 1, true)).toBe(true);
  });

  it('keeps SAVE enabled on Night 2+ when saving another player and disabled once antidote is spent', () => {
    expect(saveButtonDisabled(2, 4, true)).toBe(false);
    expect(saveButtonDisabled(2, 4, false)).toBe(true);
    expect(saveButtonDisabled(1, null, true)).toBe(true);
  });
});

describe('human ballot eligibility', () => {
  const selfVoteDisabled = (role: Role, isAlive: boolean, canVote: boolean) => {
    const me = { ...witchPlayer, role, isAlive, canVote };
    const html = renderToStaticMarkup(React.createElement(ActionBar, {
      me, selectedPlayer: me, phase: GamePhase.DAY_VOTING, isProcessingAI: false,
      witchStatus: { hasSave: true, hasPoison: true },
      nightState: { wolfKillId: null, witchPoisonId: null, witchSaved: false },
      onAction: () => {}, onVoteSkip: () => {}, onWitchSave: () => {}, onWitchSkip: () => {},
    }));
    const vote = html.match(/<button([^>]*)>[^]*?VOTE<\/button>/);
    expect(vote).not.toBeNull();
    return /\bdisabled\b/.test(vote![1]);
  };

  it.each(Object.values(Role))('permits living, enfranchised %s to select self', role => {
    expect(selfVoteDisabled(role, true, true)).toBe(false);
    expect(selfVoteDisabled(role, false, true)).toBe(true);
    expect(selfVoteDisabled(role, true, false)).toBe(true);
  });
});
