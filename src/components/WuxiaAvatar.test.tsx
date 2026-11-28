import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SKIN_CATALOG } from '../economy/catalog';
import { DEFAULT_OUTFIT_SPEC } from '../economy/skinAssets';
import { WuxiaAvatar, type WuxiaAvatarSize } from './WuxiaAvatar';

describe('WuxiaAvatar', () => {
  it('renders default outfit avatar when skin is omitted or unknown', () => {
    for (const skin of [undefined, null, { ...SKIN_CATALOG[0], id: 'unknown-skin' }]) {
      const html = renderToStaticMarkup(<WuxiaAvatar skin={skin} alt="Default traveler" />);
      expect(html).toContain('src="/assets/skins/default/avatar.webp"');
      expect(html).toContain('wuxia-avatar--basic');
      expect(html).toContain(`--wuxia-avatar-accent:${skin?.accent ?? DEFAULT_OUTFIT_SPEC.accent}`);
      expect(html).toContain('decoding="async"');
      expect(html).not.toContain('fetchpriority');
      expect(html).not.toContain('loading="lazy"');
    }
  });

  it('distinguishes Basic and Premium skin tiers and sets accent variable', () => {
    const basicSkin = SKIN_CATALOG.find(s => s.tier === 'Basic')!;
    const premiumSkin = SKIN_CATALOG.find(s => s.tier === 'Premium')!;

    const basicHtml = renderToStaticMarkup(<WuxiaAvatar skin={basicSkin} alt={basicSkin.name} />);
    expect(basicHtml).toContain(`src="/assets/skins/${basicSkin.id}/avatar.webp"`);
    expect(basicHtml).toContain('wuxia-avatar--basic');
    expect(basicHtml).not.toContain('wuxia-avatar--premium');
    expect(basicHtml).toContain(`--wuxia-avatar-accent:${basicSkin.accent}`);

    const premiumHtml = renderToStaticMarkup(<WuxiaAvatar skin={premiumSkin} alt={premiumSkin.name} />);
    expect(premiumHtml).toContain(`src="/assets/skins/${premiumSkin.id}/avatar.webp"`);
    expect(premiumHtml).toContain('wuxia-avatar--premium');
    expect(premiumHtml).not.toContain('wuxia-avatar--basic');
    expect(premiumHtml).toContain(`--wuxia-avatar-accent:${premiumSkin.accent}`);
  });

  it('renders AI folk mode when src is provided', () => {
    const html = renderToStaticMarkup(
      <WuxiaAvatar src="/assets/avatars/ai-03.webp" skin={SKIN_CATALOG[6]} alt="Seat 3" />,
    );
    expect(html).toContain('src="/assets/avatars/ai-03.webp"');
    expect(html).toContain('wuxia-avatar--folk');
    expect(html).not.toContain('wuxia-avatar--premium');
    expect(html).not.toContain('--wuxia-avatar-accent');
  });

  it('renders milestone frames with data-avatar-frame and outer ring element', () => {
    const inkHtml = renderToStaticMarkup(<WuxiaAvatar alt="Ink ring" frame="ink-ring" />);
    expect(inkHtml).toContain('data-avatar-frame="ink-ring"');
    expect(inkHtml).toContain('wuxia-avatar-frame--ink-ring');

    const crimsonHtml = renderToStaticMarkup(<WuxiaAvatar alt="Crimson moon" frame="crimson-moon" />);
    expect(crimsonHtml).toContain('data-avatar-frame="crimson-moon"');
    expect(crimsonHtml).toContain('wuxia-avatar-frame--crimson-moon');
  });

  it('supports all size variants including seat-compact and seat', () => {
    const expected: Record<WuxiaAvatarSize, string[]> = {
      sm: ['w-10 h-10', 'wuxia-avatar--sm'],
      md: ['w-12 h-12', 'wuxia-avatar--md'],
      lg: ['w-14 h-14', 'wuxia-avatar--lg'],
      'seat-compact': ['w-14 h-14', 'wuxia-avatar--seat-compact'],
      seat: ['w-16 h-16', 'wuxia-avatar--seat'],
    };

    for (const [size, tokens] of Object.entries(expected) as [WuxiaAvatarSize, string[]][]) {
      const html = renderToStaticMarkup(<WuxiaAvatar size={size} alt="Sized" />);
      for (const token of tokens) {
        expect(html).toContain(token);
      }
    }
  });

  it('supports userAuthoredAlt and lazy loading without invalid fetchpriority', () => {
    const html = renderToStaticMarkup(
      <WuxiaAvatar alt="Player One" userAuthoredAlt lazy />,
    );
    expect(html).toContain('data-ui-copy-category="USER_AUTHORED"');
    expect(html).toContain('data-ui-copy-allow="USER_PLAYER_NAME"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).not.toContain('fetchpriority');
  });

  it('includes inline SVG fallback on error and reduced-motion rules in CSS', () => {
    const tsxSource = readFileSync(new URL('./WuxiaAvatar.tsx', import.meta.url), 'utf8');
    const cssSource = readFileSync(new URL('../styles/wuxia-avatar.css', import.meta.url), 'utf8');

    expect(tsxSource).toContain('onError');
    expect(tsxSource).toContain('SumiTravelerSilhouette');
    expect(cssSource).toContain('aspect-ratio: 1 / 1');
    expect(cssSource).toContain('border-radius: 9999px');
    expect(cssSource).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
