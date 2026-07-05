import { describe, it, expect } from 'vitest';
import {
  computeWinner,
  applyElimination,
  applyNightResolution,
  resolveVoteResult,
  getRoleCamp,
} from './gameEngine';
import { Player, Role } from './types';

// ─── Test helpers ────────────────────────────────────────────────────────────
const mkPlayer = (id: number, role: Role, isAlive = true): Player => ({
  id,
  name: `P${id}`,
  role,
  camp: getRoleCamp(role),
  isAlive,
  canVote: true,
  isRevealed: false,
  avatarUrl: '',
  aiPersonality: '',
  traits: [],
  aiModelLabel: '',
  isHuman: false,
  publicClaims: [],
  privateKnowledge: [],
  suspicionMap: {},
});

// 9-player standard: 3 wolves, 3 villagers, seer, witch, hunter
const mk9 = (): Player[] => [
  mkPlayer(1, Role.WEREWOLF),
  mkPlayer(2, Role.WEREWOLF),
  mkPlayer(3, Role.WEREWOLF),
  mkPlayer(4, Role.SEER),
  mkPlayer(5, Role.WITCH),
  mkPlayer(6, Role.HUNTER),
  mkPlayer(7, Role.VILLAGER),
  mkPlayer(8, Role.VILLAGER),
  mkPlayer(9, Role.VILLAGER),
];

describe('computeWinner', () => {
  it('returns null when both camps alive', () => {
    expect(computeWinner(mk9())).toBeNull();
  });

  it('villagers win when all wolves dead', () => {
    const players = mk9().map(p => (p.role === Role.WEREWOLF ? { ...p, isAlive: false } : p));
    expect(computeWinner(players)).toBe('VILLAGERS');
  });

  it('wolves win when all villagers (commoners) dead', () => {
    const players = mk9().map(p => (p.role === Role.VILLAGER ? { ...p, isAlive: false } : p));
    expect(computeWinner(players)).toBe('WEREWOLVES');
  });

  it('wolves win when all gods dead (屠边)', () => {
    const players = mk9().map(p =>
      [Role.SEER, Role.WITCH, Role.HUNTER].includes(p.role) ? { ...p, isAlive: false } : p
    );
    expect(computeWinner(players)).toBe('WEREWOLVES');
  });
});

describe('applyElimination', () => {
  it('idiot survives first vote but loses voting rights', () => {
    const players = [...mk9(), mkPlayer(10, Role.IDIOT)];
    const result = applyElimination(players, 10, 'VOTE');
    const idiot = result.players.find(p => p.id === 10)!;
    expect(idiot.isAlive).toBe(true);
    expect(idiot.canVote).toBe(false);
    expect(idiot.isRevealed).toBe(true);
    expect(result.sparedByIdiot).toBe(true);
  });

  it('idiot dies to night kill (not vote)', () => {
    const players = [...mk9(), mkPlayer(10, Role.IDIOT)];
    const result = applyElimination(players, 10, 'NIGHT');
    expect(result.players.find(p => p.id === 10)!.isAlive).toBe(false);
  });
});

describe('resolveVoteResult', () => {
  it('returns highest-voted player', () => {
    expect(resolveVoteResult({ 3: 2, 5: 1 })).toBe(3);
  });
  it('returns null on tie', () => {
    expect(resolveVoteResult({ 3: 2, 5: 2 })).toBeNull();
  });
});

describe('applyNightResolution', () => {
  it('wolf kill applies when not saved', () => {
    const result = applyNightResolution(mk9(), { wolfKillId: 7, witchPoisonId: null, witchSaved: false });
    expect(result.deadIds).toContain(7);
  });
  it('witch save cancels wolf kill', () => {
    const result = applyNightResolution(mk9(), { wolfKillId: 7, witchPoisonId: null, witchSaved: true });
    expect(result.deadIds).not.toContain(7);
  });
  it('poison and kill both apply', () => {
    const result = applyNightResolution(mk9(), { wolfKillId: 7, witchPoisonId: 8, witchSaved: false });
    expect(result.deadIds).toContain(7);
    expect(result.deadIds).toContain(8);
  });
});
