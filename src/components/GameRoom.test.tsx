import React from 'react';
import { readFileSync } from 'node:fs';
import postcss, { type AtRule, type Rule } from 'postcss';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import GameRoom, { GamePlayerSeat } from './GameRoom';

const responsiveCss = readFileSync(new URL('../styles/game-responsive.css', import.meta.url), 'utf8');
const legacyCss = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');

const mediaAppliesAtWidth = (rule: Rule, width: number): boolean => {
  const parent = rule.parent;
  if (parent?.type !== 'atrule' || (parent as AtRule).name !== 'media') return true;

  const query = (parent as AtRule).params;
  const minWidth = query.match(/min-width:\s*(\d+)px/);
  const maxWidth = query.match(/max-width:\s*(\d+)px/);
  if (minWidth && width < Number(minWidth[1])) return false;
  if (maxWidth && width > Number(maxWidth[1])) return false;
  return true;
};

const matchesGameStage = (selector: string): boolean => {
  const normalized = selector.trim();
  return normalized === '.seat-stage' || normalized === '.game-room .seat-stage';
};

const matchesWolfChannel = (selector: string): boolean => {
  const normalized = selector.trim();
  return normalized === '.wolf-channel' || normalized === '.game-room .wolf-channel';
};

const selectorSpecificity = (selector: string): number =>
  (selector.match(/\.[a-zA-Z0-9_-]+/g) ?? []).length;

const effectiveCascade = (
  width: number,
  matchesSelector: (selector: string) => boolean,
): Record<string, string> => {
  // App imports responsive CSS before src/index.tsx imports legacy index.css.
  // Resolve that production order so an equal-specificity late rule regresses.
  const root = postcss.parse(`${responsiveCss}\n${legacyCss}`);
  const winners = new Map<string, { specificity: number; order: number; value: string }>();
  let order = 0;

  root.walkRules(rule => {
    order += 1;
    if (!mediaAppliesAtWidth(rule, width)) return;
    const selectors = rule.selectors.filter(matchesSelector);
    if (selectors.length === 0) return;
    const specificity = Math.max(...selectors.map(selectorSpecificity));

    rule.walkDecls(declaration => {
      const current = winners.get(declaration.prop);
      if (!current || specificity > current.specificity || (specificity === current.specificity && order >= current.order)) {
        winners.set(declaration.prop, { specificity, order, value: declaration.value });
      }
    });
  });

  return Object.fromEntries([...winners].map(([property, winner]) => [property, winner.value]));
};

const effectiveStageCascade = (width: number): Record<string, string> =>
  effectiveCascade(width, matchesGameStage);

const effectiveWolfChannelCascade = (width: number): Record<string, string> =>
  effectiveCascade(width, matchesWolfChannel);

describe('GameRoom responsive layout contract', () => {
  it('renders named board, desktop seat coordinates, and persistent sidebar regions', () => {
    const markup = renderToStaticMarkup(
      <GameRoom
        header={<header>Round header</header>}
        sidebar={<aside>Game log</aside>}
        boardLabel="Werewolf seats and action console"
      >
        <GamePlayerSeat desktopStyle={{ left: '50%', top: '12%', transform: 'translate(-50%, -50%)' }}>
          <button type="button">Seat 1</button>
        </GamePlayerSeat>
        <div className="center-console game-action-console">Actions</div>
      </GameRoom>,
    );

    expect(markup).toContain('class="game-room sketch-scene');
    expect(markup).toContain('class="game-room-layout"');
    expect(markup).toContain('class="game-room-main"');
    expect(markup).toContain('class="game-room-board"');
    expect(markup).toContain('aria-label="Werewolf seats and action console"');
    expect(markup).toContain('class="game-player-seat"');
    expect(markup).toContain('left:50%');
    expect(markup).toContain('<aside>Game log</aside>');
  });

  it('defines exact desktop/tablet/mobile tiers and removes absolute seats below desktop', () => {
    const css = responsiveCss;

    expect(css).toContain('@media (min-width: 1024px)');
    expect(css).toContain('@media (max-width: 1023px)');
    expect(css).toContain('@media (max-width: 640px)');
    expect(css).toMatch(/\.game-player-seat\s*\{[\s\S]*?position:\s*static !important;[\s\S]*?transform:\s*none !important;/);
    expect(css).toMatch(/\.center-console\.game-action-console\s*\{[\s\S]*?position:\s*relative;[\s\S]*?grid-column:\s*1 \/ -1;[\s\S]*?width:\s*100%;/);
    expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))');
    expect(css).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(css).toContain('overflow-y: auto');
  });

  it.each([
    [390, 'repeat(3, minmax(0, 1fr))'],
    [768, 'repeat(4, minmax(0, 1fr))'],
  ] as const)('wins the production CSS cascade with a normal-flow stage at %ipx', (width, columns) => {
    const stage = effectiveStageCascade(width);

    expect(stage.position).toBe('relative');
    expect(stage.inset).toBe('auto');
    expect(stage.display).toBe('grid');
    expect(stage.overflow).toBe('visible');
    expect(stage['grid-template-columns']).toBe(columns);
  });

  it('uses a two-column normal-flow stage at 200% mobile effective width', () => {
    const stage = effectiveStageCascade(195);

    expect(stage.position).toBe('relative');
    expect(stage.overflow).toBe('visible');
    expect(stage['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
  });

  it('keeps the narrow-screen wolf channel in flow instead of covering actions', () => {
    const wolfChannel = effectiveWolfChannelCascade(390);

    expect(wolfChannel.position).toBe('relative');
    expect(wolfChannel.left).toBe('auto');
    expect(wolfChannel.bottom).toBe('auto');
    expect(wolfChannel.width).toBe('100%');
    expect(wolfChannel['max-height']).toBe('none');
  });

  it('keeps the desktop stage as the absolute clipped seat ring', () => {
    const stage = effectiveStageCascade(1440);

    expect(stage.position).toBe('absolute');
    expect(stage.inset).toBe('16px');
    expect(stage.overflow).toBe('hidden');
  });
});
