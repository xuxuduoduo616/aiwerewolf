import React from 'react';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TopStatusBar from './TopStatusBar';

const mobileShellCss = readFileSync(new URL('../styles/mobile-shell.css', import.meta.url), 'utf8');
const appIntegrationCss = readFileSync(new URL('../styles/app-integration.css', import.meta.url), 'utf8');

const mediaMatches = (params: string, width: number, reducedMotion = false): boolean => {
  if (params.includes('prefers-reduced-motion')) return reducedMotion;
  const minimum = params.match(/min-width:\s*(\d+)px/);
  const maximum = params.match(/max-width:\s*(\d+)px/);
  return (!minimum || width >= Number(minimum[1])) && (!maximum || width <= Number(maximum[1]));
};

const effectiveDeclarationsFor = (
  selector: string,
  width: number,
  reducedMotion = false,
): Record<string, string> => {
  type CssAncestor = {
    type: string;
    name?: string;
    params?: string;
    parent?: CssAncestor;
  };
  const declarations: Record<string, string> = {};
  for (const css of [mobileShellCss, appIntegrationCss]) {
    postcss.parse(css).walkRules(rule => {
      if (!rule.selectors.includes(selector)) return;
      let ancestor = rule.parent as unknown as CssAncestor | undefined;
      while (ancestor) {
        if (ancestor.type === 'atrule' && ancestor.name === 'media'
          && !mediaMatches(ancestor.params ?? '', width, reducedMotion)) return;
        ancestor = ancestor.parent;
      }
      rule.walkDecls(declaration => {
        declarations[declaration.prop] = declaration.value;
      });
    });
  }
  return declarations;
};

const messages = [
  'Village message: Welcome to AI Werewolf · Check in daily for rewards',
  'Tidal Season skins leave the shop soon',
  'New-player protection: No energy cost for your first 10 games',
  'This week: Complete 3 games for an exclusive avatar frame',
];

describe('TopStatusBar marquee contract', () => {
  it('shows only the two named economy currencies and keeps accessible labels', () => {
    const markup = renderToStaticMarkup(
      <TopStatusBar coins={123} coupons={999} crystals={4} onOpenUtilityMenu={() => undefined} />,
    );
    expect(markup).toContain('123 Coins, Basic currency');
    expect(markup).toContain('4 Crystals, Premium currency');
    expect(markup).not.toContain('Coupons');
    expect(markup).not.toContain('999');
    expect(markup.match(/class="wol-currency-item /g)).toHaveLength(2);
    expect(markup.match(/class="wol-utility-trigger"/g)).toHaveLength(1);
  });

  it('renders two ordered copies of the exact four English messages', () => {
    const markup = renderToStaticMarkup(
      <TopStatusBar coins={0} coupons={0} crystals={0} onOpenUtilityMenu={() => undefined} />,
    );
    const renderedMessages = [...markup.matchAll(/<span class="wol-marquee-item">([^<]+)<\/span>/g)]
      .map(match => match[1]);

    expect(renderedMessages).toEqual([...messages, ...messages]);
  });

  it('keeps the moving track intrinsic and every message non-shrinking with positive spacing', () => {
    const track = effectiveDeclarationsFor('.wol-marquee-track', 390, false);
    const item = effectiveDeclarationsFor('.wol-marquee-item', 390, false);
    const hover = effectiveDeclarationsFor('.wol-marquee-track:hover', 390, false);

    expect(track).toMatchObject({
      display: 'flex',
      flex: '0 0 auto',
      width: 'max-content',
      'min-width': 'max-content',
      gap: '48px',
      'white-space': 'nowrap',
      animation: 'wolMarquee 18s linear infinite',
    });
    expect(item).toMatchObject({
      display: 'inline-flex',
      flex: '0 0 auto',
      width: 'max-content',
    });
    expect(hover['animation-play-state']).toBe('paused');
    expect(mobileShellCss).toContain('@keyframes wolMarquee');
    expect(mobileShellCss).toContain('100% { transform: translateX(-50%); }');
  });

  it.each([
    [390, 'repeat(2, minmax(0, 1fr)) 44px'],
    [768, 'repeat(2, minmax(0, 180px)) 44px'],
    [1440, 'repeat(2, minmax(0, 200px)) 44px'],
    // A 1440px viewport at effective 200% zoom exposes about 720 CSS pixels.
    [720, 'repeat(2, minmax(0, 180px)) 44px'],
  ])('uses a two-currency plus utility grid at %ipx CSS width', (width, expectedColumns) => {
    expect(effectiveDeclarationsFor('.wol-currency-row', width)['grid-template-columns']).toBe(expectedColumns);
    expect(effectiveDeclarationsFor('.wol-shell .wol-store-wallet', width)['grid-template-columns'])
      .toBe('repeat(2, minmax(0, 1fr))');
  });

  it('stops the infinite marquee when reduced motion is requested', () => {
    const track = effectiveDeclarationsFor('.wol-marquee-track', 390, true);
    expect(track.animation).toBe('none');
    expect(track.transform).toBe('none');
  });
});
