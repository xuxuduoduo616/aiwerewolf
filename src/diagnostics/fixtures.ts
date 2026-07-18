/**
 * Diagnostics — fixed test-game fixture + seeded PRNG.
 *
 * DIAGNOSIS ONLY (card: ai-speech-name-detection-harness). The audit fixture
 * is a fixed 9p standard board: same seat→role layout as MODE_9_PLAYER after
 * a fixed (non-shuffled) deal, names assigned exactly like startGame does
 * (AI_NAMES[index % AI_NAMES.length], useGameState.ts:326). All seats are AI
 * so every seat generates speech offline.
 */

import { Role, type Player } from '../types';
import { AI_NAMES } from '../constants';
import { getRoleCamp } from '../gameEngine';

/** Deterministic PRNG (mulberry32) for vi.spyOn(Math, 'random'). */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Fixed seed for the whole audit — do not change without updating the report. */
export const AUDIT_SEED = 0x5eed2026;

/** Fixed seat→role deal for the 9p board (3民3狼 + 预女猎). */
export const AUDIT_ROSTER_ROLES: ReadonlyArray<Role> = [
  Role.VILLAGER,
  Role.WEREWOLF, Role.WEREWOLF, Role.WEREWOLF,
  Role.SEER, Role.WITCH, Role.HUNTER,
  Role.VILLAGER, Role.VILLAGER,
];

export const makeAuditRoster = (): Player[] =>
  AUDIT_ROSTER_ROLES.map((role, index) => ({
    id: index + 1,
    name: AI_NAMES[index % AI_NAMES.length],
    role,
    camp: getRoleCamp(role),
    isAlive: true,
    canVote: true,
    isRevealed: false,
    avatarUrl: '',
    aiPersonality: 'audit',
    traits: [],
    aiModelLabel: 'GPT-4o',
    isHuman: false,
    isWolfHopper: index === 1, // seat 2 is the fixed hopper wolf
    publicClaims: [],
    privateKnowledge: [],
    suspicionMap: {},
  }));
