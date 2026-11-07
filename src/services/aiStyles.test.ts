import { describe, expect, it } from 'vitest';
import { pickRolePersona, ROLE_PERSONAS } from './aiStyles';

describe('public speech personas', () => {
  it('defines exactly one persona per purpose and wording combination', () => {
    const purposes = ['attack', 'defense', 'brief', 'rally', 'analysis'];
    const tones = ['firm', 'hesitant', 'confident'];
    const ids = ROLE_PERSONAS.map(persona => persona.id);
    expect(ids).toHaveLength(15);
    expect(new Set(ids)).toEqual(new Set(purposes.flatMap(purpose => tones.map(tone => `${purpose}-${tone}`))));
  });

  it('samples all 15 entries across the full random range', () => {
    expect(pickRolePersona(() => 0)).toBe(ROLE_PERSONAS[0]);
    expect(pickRolePersona(() => 1 - Number.EPSILON)).toBe(ROLE_PERSONAS[14]);
    for (const [index, persona] of ROLE_PERSONAS.entries()) {
      expect(pickRolePersona(() => (index + 0.5) / 15)).toBe(persona);
    }
  });
});
