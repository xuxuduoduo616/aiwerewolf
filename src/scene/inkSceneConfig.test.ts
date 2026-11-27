import { describe, expect, it } from 'vitest';
import { INK_SCENES, resolveShellSceneId, type InkSceneId } from './inkSceneConfig';

describe('ink-wash scene registry and routing', () => {
  it('defines distinct WebP artwork and balanced motion parameters for every scene', () => {
    const ids = Object.keys(INK_SCENES) as InkSceneId[];
    expect(ids.sort()).toEqual([
      'game-day',
      'game-night',
      'lobby',
      'match-setup',
      'profile',
      'shop',
      'sign-in',
      'village',
    ]);

    const paths = new Set(ids.map(id => INK_SCENES[id].imageSrc));
    expect(paths.size).toBe(ids.length);
    for (const id of ids) {
      const spec = INK_SCENES[id];
      expect(spec.imageSrc).toMatch(/^\/assets\/scenes\/[a-z-]+\.webp(?:\?v=[a-z0-9]+)?$/);
      expect(spec.scrimOpacity).toBeGreaterThanOrEqual(0.2);
      expect(spec.scrimOpacity).toBeLessThanOrEqual(0.6);
    }
  });

  it('routes every shell surface to a tailored scene rather than repeating one background', () => {
    expect(resolveShellSceneId(null, 'home', 'home')).toBe('lobby');
    expect(resolveShellSceneId(null, 'home', 'mode-choice')).toBe('match-setup');
    expect(resolveShellSceneId(null, 'home', 'match-setup')).toBe('match-setup');
    expect(resolveShellSceneId(null, 'home', 'online-qualifier')).toBe('match-setup');
    expect(resolveShellSceneId(null, 'home', 'daily-check-in')).toBe('shop');
    expect(resolveShellSceneId(null, 'home', 'economy-history')).toBe('shop');
    expect(resolveShellSceneId(null, 'home', 'activity')).toBe('village');
    expect(resolveShellSceneId(null, 'home', 'faction-support')).toBe('village');
    expect(resolveShellSceneId(null, 'home', 'battle-pass')).toBe('village');
    expect(resolveShellSceneId(null, 'shop', 'home')).toBe('shop');
    expect(resolveShellSceneId(null, 'profile', 'home')).toBe('profile');
    expect(resolveShellSceneId(null, 'wolfvillage', 'home')).toBe('village');
    expect(resolveShellSceneId(null, 'friends', 'home')).toBe('village');
    expect(resolveShellSceneId('menu', 'home', 'home')).toBe('profile');
  });
});
