import React from 'react';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TopStatusBar from './TopStatusBar';

const mobileShellCss = readFileSync(new URL('../styles/mobile-shell.css', import.meta.url), 'utf8');

const declarationsFor = (selector: string): Record<string, string> => {
  const declarations: Record<string, string> = {};
  postcss.parse(mobileShellCss).walkRules(rule => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(declaration => {
      declarations[declaration.prop] = declaration.value;
    });
  });
  return declarations;
};

const messages = [
  'Village message: Welcome to AI Werewolf · Check in daily for rewards',
  'Tidal Season skins leave the shop soon',
  'New-player protection: No energy cost for your first 10 games',
  'This week: Complete 3 games for an exclusive avatar frame',
];

describe('TopStatusBar marquee contract', () => {
  it('renders two ordered copies of the exact four English messages', () => {
    const markup = renderToStaticMarkup(
      <TopStatusBar coins={0} coupons={0} crystals={0} onOpenUtilityMenu={() => undefined} />,
    );
    const renderedMessages = [...markup.matchAll(/<span class="wol-marquee-item">([^<]+)<\/span>/g)]
      .map(match => match[1]);

    expect(renderedMessages).toEqual([...messages, ...messages]);
  });

  it('keeps the moving track intrinsic and every message non-shrinking with positive spacing', () => {
    const track = declarationsFor('.wol-marquee-track');
    const item = declarationsFor('.wol-marquee-item');
    const hover = declarationsFor('.wol-marquee-track:hover');

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
});
