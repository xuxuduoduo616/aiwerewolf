import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import SkinArtwork from './SkinArtwork';
import { SKIN_CATALOG } from '../economy/catalog';

describe('SkinArtwork', () => {
  it('renders a 3:4 Retina WebP portrait for a Basic skin with lazy loading', () => {
    const basicSkin = SKIN_CATALOG.find(item => item.tier === 'Basic')!;
    const html = renderToStaticMarkup(<SkinArtwork product={basicSkin} />);
    expect(html).toContain(`data-skin-id="${basicSkin.id}"`);
    expect(html).toContain('data-skin-tier="Basic"');
    expect(html).not.toContain('skin-artwork--premium');
    expect(html).toContain(`src="/assets/skins/${basicSkin.id}/portrait.webp"`);
    expect(html).toContain(`alt="${basicSkin.name} ink-wash portrait"`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).not.toContain('fetchpriority');
  });

  it('renders a Premium skin with premium framing and eager loading when large', () => {
    const premiumSkin = SKIN_CATALOG.find(item => item.tier === 'Premium')!;
    const html = renderToStaticMarkup(<SkinArtwork product={premiumSkin} large />);
    expect(html).toContain('data-skin-tier="Premium"');
    expect(html).toContain('skin-artwork--premium');
    expect(html).toContain('skin-artwork--large');
    expect(html).toContain(`src="/assets/skins/${premiumSkin.id}/portrait.webp"`);
    expect(html).not.toContain('loading="lazy"');
  });

  it('renders Default Outfit portrait when defaultOutfit is true', () => {
    const html = renderToStaticMarkup(<SkinArtwork defaultOutfit />);
    expect(html).toContain('data-skin-id="default"');
    expect(html).toContain('data-skin-tier="Basic"');
    expect(html).toContain('src="/assets/skins/default/portrait.webp"');
    expect(html).toContain('alt="Default Outfit ink-wash portrait"');
  });
});
