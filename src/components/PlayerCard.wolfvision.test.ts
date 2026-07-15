import { describe, it, expect } from 'vitest';
import { Role } from '../types';
import { getRoleCamp } from '../gameEngine';
import type { Player } from '../types';

const MY_PLAYER_ID = 1;

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
  isHuman: id === MY_PLAYER_ID,
  publicClaims: [],
  privateKnowledge: [],
  suspicionMap: {},
});

/**
 * Mirrors the isWolfTeammate computation from App.tsx seat stage.
 *
 *   const isHumanWolf = me?.role === Role.WEREWOLF && me?.isAlive === true;
 *   const isWolfTeammate = isHumanWolf && player.id !== MY_PLAYER_ID && player.camp === 'WEREWOLF';
 */
const computeIsWolfTeammate = (me: Player | undefined, player: Player): boolean => {
  const isHumanWolf = me?.role === Role.WEREWOLF && me?.isAlive === true;
  return isHumanWolf && player.id !== MY_PLAYER_ID && player.camp === 'WEREWOLF';
};

// ── Wolf vision correctness ───────────────────────────────────────────────────

describe('wolf teammate visual: wolf vision correctness', () => {
  it('shows badge on AI wolf teammate when human is a live werewolf', () => {
    const me = mkPlayer(MY_PLAYER_ID, Role.WEREWOLF);
    const teammate = mkPlayer(2, Role.WEREWOLF);

    expect(computeIsWolfTeammate(me, teammate)).toBe(true);
  });

  it('shows badge on dead wolf teammate — badge persists after teammate death', () => {
    const me = mkPlayer(MY_PLAYER_ID, Role.WEREWOLF);
    const deadTeammate = mkPlayer(3, Role.WEREWOLF, /* isAlive */ false);

    expect(computeIsWolfTeammate(me, deadTeammate)).toBe(true);
  });

  it('does NOT flag the human player\'s own card as a wolf teammate', () => {
    const me = mkPlayer(MY_PLAYER_ID, Role.WEREWOLF);

    expect(computeIsWolfTeammate(me, me)).toBe(false);
  });

  it('returns false for all players when human is a live werewolf but targets are not wolves', () => {
    const me = mkPlayer(MY_PLAYER_ID, Role.WEREWOLF);
    const villager = mkPlayer(4, Role.VILLAGER);
    const seer = mkPlayer(5, Role.SEER);
    const witch = mkPlayer(6, Role.WITCH);
    const hunter = mkPlayer(7, Role.HUNTER);

    expect(computeIsWolfTeammate(me, villager)).toBe(false);
    expect(computeIsWolfTeammate(me, seer)).toBe(false);
    expect(computeIsWolfTeammate(me, witch)).toBe(false);
    expect(computeIsWolfTeammate(me, hunter)).toBe(false);
  });
});

// ── Permission leakage: non-wolf players must NOT see the badge ───────────────

describe('wolf teammate visual: permission leakage', () => {
  it('villager player sees NO wolf badges on any player', () => {
    const me = mkPlayer(MY_PLAYER_ID, Role.VILLAGER);
    const wolf1 = mkPlayer(2, Role.WEREWOLF);
    const wolf2 = mkPlayer(3, Role.WEREWOLF);
    const villager = mkPlayer(4, Role.VILLAGER);

    expect(computeIsWolfTeammate(me, wolf1)).toBe(false);
    expect(computeIsWolfTeammate(me, wolf2)).toBe(false);
    expect(computeIsWolfTeammate(me, villager)).toBe(false);
  });

  it('seer player sees NO wolf badges', () => {
    const me = mkPlayer(MY_PLAYER_ID, Role.SEER);
    const wolf = mkPlayer(2, Role.WEREWOLF);

    expect(computeIsWolfTeammate(me, wolf)).toBe(false);
  });

  it('witch player sees NO wolf badges', () => {
    const me = mkPlayer(MY_PLAYER_ID, Role.WITCH);
    const wolf = mkPlayer(2, Role.WEREWOLF);

    expect(computeIsWolfTeammate(me, wolf)).toBe(false);
  });

  it('hunter player sees NO wolf badges', () => {
    const me = mkPlayer(MY_PLAYER_ID, Role.HUNTER);
    const wolf = mkPlayer(2, Role.WEREWOLF);

    expect(computeIsWolfTeammate(me, wolf)).toBe(false);
  });

  it('dead human werewolf sees NO wolf badges after death', () => {
    const me = mkPlayer(MY_PLAYER_ID, Role.WEREWOLF, /* isAlive */ false);
    const teammate = mkPlayer(2, Role.WEREWOLF);

    // me.isAlive is false — gate closes, no badges leak
    expect(computeIsWolfTeammate(me, teammate)).toBe(false);
  });

  it('undefined me sees NO wolf badges', () => {
    const wolf = mkPlayer(2, Role.WEREWOLF);

    expect(computeIsWolfTeammate(undefined, wolf)).toBe(false);
  });
});
