import { describe, expect, it } from 'vitest';
import { shuffleRoles } from './roleDeal';

describe('shuffleRoles', () => {
  it('returns a permutation and never mutates the input', () => {
    const roles = ['a', 'b', 'c', 'd', 'e'] as const;
    const result = shuffleRoles(roles);
    expect([...result].sort()).toEqual([...roles]);
    expect(roles).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('deals every role to every seat with near-uniform frequency', () => {
    // Seeded LCG keeps the statistical check deterministic.
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const roles = [0, 1, 2, 3];
    const trials = 40000;
    const counts = roles.map(() => roles.map(() => 0));
    for (let t = 0; t < trials; t += 1) {
      shuffleRoles(roles, random).forEach((role, seat) => { counts[seat][role] += 1; });
    }
    const expected = trials / roles.length;
    for (const seat of counts) {
      for (const count of seat) expect(Math.abs(count - expected) / expected).toBeLessThan(0.05);
    }
  });
});
