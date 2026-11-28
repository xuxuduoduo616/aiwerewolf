import { describe, expect, it } from 'vitest';
import { SKIN_CATALOG } from './catalog';
import {
  AI_AVATAR_COUNT,
  AI_AVATAR_URLS,
  DEFAULT_OUTFIT_SPEC,
  WUXIA_SKIN_IDS,
  getAiAvatarUrl,
  getSkinAvatarUrl,
  getSkinPortraitUrl,
  isWuxiaSkinId,
} from './skinAssets';

describe('skinAssets', () => {
  it('lists all 7 catalog skins in WUXIA_SKIN_IDS and validates them with isWuxiaSkinId', () => {
    expect(WUXIA_SKIN_IDS).toHaveLength(7);
    expect(WUXIA_SKIN_IDS).toEqual(SKIN_CATALOG.map(product => product.id));

    for (const skinId of WUXIA_SKIN_IDS) {
      expect(isWuxiaSkinId(skinId)).toBe(true);
    }

    expect(isWuxiaSkinId('default')).toBe(false);
    expect(isWuxiaSkinId('unknown-skin')).toBe(false);
    expect(isWuxiaSkinId('')).toBe(false);
  });

  it('exports DEFAULT_OUTFIT_SPEC with expected default values', () => {
    expect(DEFAULT_OUTFIT_SPEC).toEqual({
      id: 'default',
      name: 'Default Outfit',
      subtitle: 'Lone Jianghu Wanderer',
      description: 'Your original Jianghu wanderer in a bamboo hat. Always included in your collection.',
      accent: '#8e8a80',
    });
  });

  it('builds portrait and avatar URLs for known skins and falls back to default otherwise', () => {
    for (const skinId of WUXIA_SKIN_IDS) {
      expect(getSkinPortraitUrl(skinId)).toBe(`/assets/skins/${skinId}/portrait.webp`);
      expect(getSkinAvatarUrl(skinId)).toBe(`/assets/skins/${skinId}/avatar.webp`);
    }

    for (const fallbackInput of [undefined, null, '', 'default', 'retired-skin']) {
      expect(getSkinPortraitUrl(fallbackInput)).toBe('/assets/skins/default/portrait.webp');
      expect(getSkinAvatarUrl(fallbackInput)).toBe('/assets/skins/default/avatar.webp');
    }
  });

  it('provides 12 AI folk avatar URLs and wraps seat indices safely', () => {
    expect(AI_AVATAR_COUNT).toBe(12);
    expect(AI_AVATAR_URLS).toHaveLength(12);
    expect(AI_AVATAR_URLS[0]).toBe('/assets/avatars/ai-01.webp');
    expect(AI_AVATAR_URLS[11]).toBe('/assets/avatars/ai-12.webp');

    expect(getAiAvatarUrl(0)).toBe('/assets/avatars/ai-01.webp');
    expect(getAiAvatarUrl(11)).toBe('/assets/avatars/ai-12.webp');
    expect(getAiAvatarUrl(12)).toBe('/assets/avatars/ai-01.webp');
    expect(getAiAvatarUrl(13)).toBe('/assets/avatars/ai-02.webp');
    expect(getAiAvatarUrl(-1)).toBe('/assets/avatars/ai-12.webp');
  });
});
