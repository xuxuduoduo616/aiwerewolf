import { describe, expect, it } from 'vitest';
import { GamePhase } from '../types';
import { findNewlyFallen, getPhaseCue, getTimeOfDay } from './phaseCues';

describe('phase atmosphere', () => {
  it('treats every night sub-phase as night and the rest as day', () => {
    for (const phase of [GamePhase.NIGHT_START, GamePhase.NIGHT_WEREWOLVES, GamePhase.NIGHT_SEER, GamePhase.NIGHT_WITCH]) {
      expect(getTimeOfDay(phase)).toBe('night');
    }
    for (const phase of [GamePhase.DAY_ANNOUNCE, GamePhase.DAY_DISCUSSION, GamePhase.DAY_VOTING, GamePhase.GAME_OVER]) {
      expect(getTimeOfDay(phase)).toBe('day');
    }
  });
});

describe('getPhaseCue', () => {
  it('leaves the opening night to the match ceremony', () => {
    expect(getPhaseCue(null, GamePhase.NIGHT_START, 0)).toBeNull();
    expect(getPhaseCue(GamePhase.LOBBY, GamePhase.NIGHT_START, 0)).toBeNull();
  });

  it('labels the coming night before the round increments', () => {
    expect(getPhaseCue(GamePhase.DAY_VOTING, GamePhase.NIGHT_START, 1)).toMatchObject({ kind: 'nightfall', title: 'Night 2' });
  });

  it('announces daybreak and the vote, and stays quiet for minor steps', () => {
    expect(getPhaseCue(GamePhase.NIGHT_WITCH, GamePhase.DAY_ANNOUNCE, 1)).toMatchObject({ kind: 'daybreak', title: 'Day 1' });
    expect(getPhaseCue(GamePhase.DAY_DISCUSSION, GamePhase.DAY_VOTING, 1)?.kind).toBe('vote');
    expect(getPhaseCue(GamePhase.NIGHT_WEREWOLVES, GamePhase.NIGHT_SEER, 1)).toBeNull();
    expect(getPhaseCue(GamePhase.DAY_VOTING, GamePhase.DAY_VOTING, 1)).toBeNull();
  });
});

describe('findNewlyFallen', () => {
  it('reports only alive → dead transitions of known seats', () => {
    const previous = new Map([[1, true], [2, true], [3, false]]);
    expect(findNewlyFallen(previous, [
      { id: 1, isAlive: true }, { id: 2, isAlive: false }, { id: 3, isAlive: false }, { id: 4, isAlive: false },
    ])).toEqual([2]);
  });
});
