import { describe, expect, it } from 'vitest';
import { Role } from '../types';
import {
  AIWOLF_COVERED_ROLES,
  BEHAVIOR_SOURCES,
  isValidRoleBehaviorParams,
  type RoleBehaviorParams,
} from './behaviorSchema';

const validVillagerParams = (): RoleBehaviorParams => ({
  claimTiming: { value: 'never', source: 'heuristic' },
  voteFollowsSuspicion: { value: 0.7, source: 'heuristic' },
  speechAggressiveness: { value: 0.5, source: 'heuristic' },
});

const validWitchParams = (): RoleBehaviorParams => ({
  claimTiming: { value: 'when-pressured', source: 'synthetic' },
  voteFollowsSuspicion: { value: 0.75, source: 'synthetic' },
  speechAggressiveness: { value: 0.5, source: 'synthetic' },
  saveThreshold: { value: 0.55, source: 'synthetic' },
  poisonThreshold: { value: 0.7, source: 'synthetic' },
});

describe('behaviorSchema', () => {
  it('declares exactly the three provenance sources', () => {
    expect(BEHAVIOR_SOURCES).toEqual(['aiwolf-distilled', 'synthetic', 'heuristic']);
  });

  it('limits AIWolf coverage to Werewolf/Villager/Seer', () => {
    expect([...AIWOLF_COVERED_ROLES].sort()).toEqual(
      [Role.WEREWOLF, Role.VILLAGER, Role.SEER].sort(),
    );
  });

  it('accepts a valid shared parameter set', () => {
    expect(isValidRoleBehaviorParams(Role.VILLAGER, validVillagerParams())).toBe(true);
  });

  it('accepts a valid witch parameter set with role-specific params', () => {
    expect(isValidRoleBehaviorParams(Role.WITCH, validWitchParams())).toBe(true);
  });

  it('rejects out-of-range numeric values', () => {
    const p = validVillagerParams();
    p.voteFollowsSuspicion = { value: 1.2, source: 'heuristic' };
    expect(isValidRoleBehaviorParams(Role.VILLAGER, p)).toBe(false);
  });

  it('rejects unknown source tags', () => {
    const p = validVillagerParams();
    p.speechAggressiveness = { value: 0.5, source: 'trained' as never };
    expect(isValidRoleBehaviorParams(Role.VILLAGER, p)).toBe(false);
  });

  it('rejects unknown claim timings', () => {
    const p = validVillagerParams();
    p.claimTiming = { value: 'day3' as never, source: 'heuristic' };
    expect(isValidRoleBehaviorParams(Role.VILLAGER, p)).toBe(false);
  });

  it('rejects aiwolf-distilled labels on roles absent from AIWolf', () => {
    const p = validWitchParams();
    p.saveThreshold = { value: 0.55, source: 'aiwolf-distilled' };
    expect(isValidRoleBehaviorParams(Role.WITCH, p)).toBe(false);
  });

  it('rejects missing role-specific params for their owner role', () => {
    const p = validWitchParams();
    delete p.poisonThreshold;
    expect(isValidRoleBehaviorParams(Role.WITCH, p)).toBe(false);
  });

  it('rejects role-specific params on roles whose consumers cannot read them', () => {
    const p = validVillagerParams();
    p.shootThreshold = { value: 0.5, source: 'heuristic' };
    expect(isValidRoleBehaviorParams(Role.VILLAGER, p)).toBe(false);
  });
});
