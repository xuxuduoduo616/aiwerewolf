import { describe, expect, it } from 'vitest';
import { resolvePublicPlayerName } from './useGameState';

describe('game public identity gate', () => {
  it('uses the already-resolved Nickname or guest-derived label', () => {
    expect(resolvePublicPlayerName(' Village Traveler ')).toBe('Village Traveler');
    expect(resolvePublicPlayerName('Guest 11111111')).toBe('Guest 11111111');
  });

  it('fails closed instead of deriving a player name from email or a fake default', () => {
    expect(resolvePublicPlayerName('')).toBeNull();
    expect(resolvePublicPlayerName('   ')).toBeNull();
  });
});
