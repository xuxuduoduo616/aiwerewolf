import { readFileSync } from 'node:fs';
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

  it('uses local Wuxia skin/AI avatar helpers instead of dicebear', () => {
    const source = readFileSync(new URL('./useGameState.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('dicebear');
    expect(source).not.toContain('AVATAR_SEEDS');
    expect(source).toContain('getSkinAvatarUrl');
    expect(source).toContain('getAiAvatarUrl');
  });
});
