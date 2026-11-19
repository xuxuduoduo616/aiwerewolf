import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { GamePhase, Role, type Player } from '../types';
import { getRoleCamp } from '../gameEngine';
import WolfStrategyChips, { WOLF_STRATEGIES, appendWolfTemplate, wolfStrategyTemplate } from './WolfStrategyChips';
import SpeechInput from './SpeechInput';
import ActionBar from './ActionBar';

const player = (id: number, role: Role, isHuman = false): Player => ({ id, role, isHuman, camp: getRoleCamp(role), name: `Seat ${id}`, isAlive: true,
  canVote: true, isRevealed: false, avatarUrl: '', aiPersonality: '', traits: [], aiModelLabel: '', publicClaims: [], privateKnowledge: [], suspicionMap: {} });
const players = [player(1, Role.WEREWOLF, true), player(2, Role.WEREWOLF), player(3, Role.WEREWOLF), player(4, Role.SEER), player(5, Role.VILLAGER)];

describe('editable wolf strategy suggestions', () => {
  it('offers all six English strategies without submitting', () => {
    const onChange = vi.fn();
    const html = renderToStaticMarkup(<WolfStrategyChips players={players} value="" onChange={onChange} />);
    for (const label of WOLF_STRATEGIES) expect(html).toContain(label);
    expect(onChange).not.toHaveBeenCalled();
    expect(html).not.toMatch(/[\p{Script=Han}]/u);
  });
  it('builds legal context-aware templates and supports combining drafts', () => {
    expect(wolfStrategyTemplate('Suggest a Night Kill', players, { id: 5 })).toContain('kill Player 5');
    expect(wolfStrategyTemplate('Suggest a Night Kill', players, { id: 2 })).toContain('kill Player 4');
    expect(wolfStrategyTemplate('Bus a Teammate', players, { id: 3 })).toContain('distance myself from Player 3');
    expect(wolfStrategyTemplate('Assign Teammate Roles', players)).toContain('Player 2, please claim Seer');
    expect(wolfStrategyTemplate('Assign Teammate Roles', players)).toContain('Player 3, lead the push');
    expect(appendWolfTemplate('My custom plan.', 'An added idea.')).toBe('My custom plan.\nAn added idea.');
    expect(appendWolfTemplate(' ', 'A fresh plan.')).toBe('A fresh plan.');
  });
  it('does not invent seats when teammates or legal targets are absent', () => {
    for (const label of WOLF_STRATEGIES) expect(wolfStrategyTemplate(label, [])).not.toMatch(/undefined|Player X|Player \d|NaN/);
    const withoutDeadAlly = players.map(p => p.id === 2 ? { ...p, isAlive: false } : p);
    expect(wolfStrategyTemplate('Assign Teammate Roles', withoutDeadAlly)).not.toContain('Player 2');
  });
  it('reuses voice input, keeps the draft editable during AI work and does not render day presets', () => {
    const html = renderToStaticMarkup(<SpeechInput value="My editable plan." onChange={vi.fn()} onSubmit={vi.fn()} visible wolfPlayers={players} />);
    expect(html).toContain('textarea'); expect(html).toContain('Message your pack');
    expect(html).toContain('My editable plan.'); expect(html).toContain('Send to pack');
    expect(html).toContain('data-voice-control'); expect(html).not.toContain('game-speech-presets');
    expect(html).toContain('maxLength="1200"');
  });
  it('offers skip only after the human has confirmed a target', () => {
    const props = { phase: GamePhase.NIGHT_WEREWOLVES, me: players[0], selectedPlayer: players[3], isProcessingAI: false,
      witchStatus: { hasSave: true, hasPoison: true }, nightState: { wolfKillId: null as number | null, witchSaved: false, witchPoisonId: null },
      onAction: vi.fn(), onVoteSkip: vi.fn(), onWitchSave: vi.fn(), onWitchSkip: vi.fn(), onSkipWolfChat: vi.fn() };
    const before = renderToStaticMarkup(<ActionBar {...props} />);
    expect(before).toContain('KILL'); expect(before).not.toContain('Skip night chat');
    const after = renderToStaticMarkup(<ActionBar {...props} nightState={{ ...props.nightState, wolfKillId: 4 }} />);
    expect(after).toContain('Skip night chat'); expect(after).not.toContain('KILL');
  });
});
