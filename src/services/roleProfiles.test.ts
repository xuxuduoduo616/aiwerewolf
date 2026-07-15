import { describe, expect, it } from 'vitest';
import { Role } from '../types';
import {
  ROLE_BEHAVIOR_PROFILES,
  getRoleBehaviorProfile,
  type BehaviorVariant,
  type RoleBehaviorProfile,
} from './roleProfiles';

const NUMERIC_PARAMS: Array<keyof RoleBehaviorProfile> = [
  'accusationConfidence',
  'poisonSaveThreshold',
  'voteRationality',
  'bluffProbability',
];

// Roles that carry the required 3-variant distinct behavior contract.
const DRIVEN_ROLES: Role[] = [Role.SEER, Role.WITCH, Role.HUNTER, Role.VILLAGER, Role.WEREWOLF];

describe('roleProfiles', () => {
  it('provides cautious/balanced/aggressive variants for every role', () => {
    const variants: BehaviorVariant[] = ['cautious', 'balanced', 'aggressive'];
    for (const role of Object.values(Role)) {
      for (const variant of variants) {
        const profile = getRoleBehaviorProfile(role, variant);
        expect(profile.role).toBe(role);
        expect(profile.variant).toBe(variant);
        expect(profile.speechStyle.length).toBeGreaterThan(0);
        expect(profile.systemPromptAddendum.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps all numeric params within the 0-1 range', () => {
    for (const byVariant of Object.values(ROLE_BEHAVIOR_PROFILES)) {
      for (const profile of Object.values(byVariant)) {
        for (const param of NUMERIC_PARAMS) {
          const v = profile[param] as number;
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('cautious vs aggressive differ by >= 0.2 in at least 2 numeric params per driven role', () => {
    for (const role of DRIVEN_ROLES) {
      const cautious = getRoleBehaviorProfile(role, 'cautious');
      const aggressive = getRoleBehaviorProfile(role, 'aggressive');
      const bigDiffs = NUMERIC_PARAMS.filter(
        (p) => Math.abs((cautious[p] as number) - (aggressive[p] as number)) >= 0.2,
      );
      expect(bigDiffs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives distinct system prompt addenda across the variants of a role', () => {
    for (const role of DRIVEN_ROLES) {
      const addenda = new Set(
        (['cautious', 'balanced', 'aggressive'] as BehaviorVariant[]).map(
          (v) => getRoleBehaviorProfile(role, v).systemPromptAddendum,
        ),
      );
      expect(addenda.size).toBe(3);
    }
  });
});
