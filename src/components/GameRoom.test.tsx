import React from 'react';
import { readFileSync } from 'node:fs';
import postcss, { type AtRule, type Rule } from 'postcss';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import GameRoom, { GamePlayerSeat } from './GameRoom';

const responsiveCss = readFileSync(new URL('../styles/game-responsive.css', import.meta.url), 'utf8');
const legacyCss = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');

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

const matchesSpeechConsole = (selector: string): boolean => {
  const normalized = selector.trim();
  return normalized === '.center-console'
    || normalized === '.game-room .center-console.game-action-console:has(.game-speech-presets)';
};

const finalTwelvePlayerSeatRect = (index: number, shoulderRadius: number) => {
  const angle = -90 + (360 / 12) * index;
  const radians = (angle * Math.PI) / 180;
  const isShoulderSeat = [2, 4, 8, 10].includes(index);
  const verticalRadius = isShoulderSeat ? shoulderRadius : 37;
  const centerX = ((50 + 42 * Math.cos(radians)) / 100) * 1068;
  const centerY = ((50 + verticalRadius * Math.sin(radians)) / 100) * 804;
  return {
    left: centerX - 54,
    right: centerX + 54,
    top: centerY - 80,
    bottom: centerY + 80,
  };
};

const intersectingSeatPairs = (shoulderRadius: number): string[] => {
  const seats = Array.from({ length: 12 }, (_, index) => finalTwelvePlayerSeatRect(index, shoulderRadius));
  const intersections: string[] = [];
  for (let leftIndex = 0; leftIndex < seats.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < seats.length; rightIndex += 1) {
      const left = seats[leftIndex];
      const right = seats[rightIndex];
      const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left);
      const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      if (overlapWidth > 1 && overlapHeight > 1) intersections.push(`${leftIndex + 1}/${rightIndex + 1}`);
    }
  }
  return intersections;
};

const dynamicPlayerRect = (index: number, total: number) => {
  const angle = -90 + (360 / total) * index;
  const radians = (angle * Math.PI) / 180;
  const centerX = 16 + ((50 + 42 * Math.cos(radians)) / 100) * 1068;
  const centerY = 80 + ((50 + 37 * Math.sin(radians)) / 100) * 804;
  const halfHeight = index === 0 ? 68 : 66;
  return {
    left: centerX - 54,
    right: centerX + 54,
    top: centerY - halfHeight,
    bottom: centerY + halfHeight,
  };
};

const centeredConsoleRect = (width: number, height: number) => ({
  left: 550 - width / 2,
  right: 550 + width / 2,
  top: 482 - height / 2,
  bottom: 482 + height / 2,
});

const intersectingDynamicPlayers = (total: number, consoleWidth: number, consoleHeight: number): number[] => {
  const consoleRect = centeredConsoleRect(consoleWidth, consoleHeight);
  return Array.from({ length: total }, (_, index) => ({ index, rect: dynamicPlayerRect(index, total) }))
    .filter(({ rect }) => {
      const overlapWidth = Math.min(rect.right, consoleRect.right) - Math.max(rect.left, consoleRect.left);
      const overlapHeight = Math.min(rect.bottom, consoleRect.bottom) - Math.max(rect.top, consoleRect.top);
      return overlapWidth > 1 && overlapHeight > 1;
    })
    .map(({ index }) => index + 1);
};

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

  it('separates the four final-state 12-player shoulder-seat intersections', () => {
    expect(intersectingSeatPairs(37)).toEqual(['3/4', '4/5', '9/10', '10/11']);
    expect(intersectingSeatPairs(40.5)).toEqual([]);
    expect(appSource).toContain("total === 12 && [2, 4, 8, 10].includes(index)");
    expect(appSource).toContain('isFinalTwelvePlayerShoulderSeat ? 40.5 : 37');
  });

  it('keeps Return to Lobby above 44px during the scaled victory intro', () => {
    expect(appSource).toContain('className="mt-5 action-button game-return-button"');
    expect(responsiveCss).toMatch(/\.game-room \.game-return-button\s*\{[\s\S]*?min-height:\s*49px;/);
    const returnTarget = effectiveCascade(1440, selector => selector.trim() === '.game-room .game-return-button' || selector.trim() === '.action-button');
    expect(returnTarget['min-height']).toBe('49px');
    expect(49 * 0.9).toBeGreaterThanOrEqual(43.5);
  });

  it('compacts only the complete desktop speech composition away from the 12-player ring', () => {
    expect(intersectingDynamicPlayers(12, 420, 462)).toEqual([1, 2, 6, 8, 12]);
    expect(intersectingDynamicPlayers(12, 420, 478)).toEqual([1, 2, 6, 7, 8, 12]);
    expect(intersectingDynamicPlayers(12, 336, 440)).toEqual([]);
    expect(intersectingDynamicPlayers(9, 336, 424)).toEqual([]);

    const desktopSpeechConsole = effectiveCascade(1440, matchesSpeechConsole);
    const responsiveSpeechConsole = effectiveCascade(768, matchesSpeechConsole);
    expect(desktopSpeechConsole.width).toBe('336px');
    expect(responsiveSpeechConsole.width).toBe('min(390px, 54vw)');
    expect(responsiveCss).toMatch(/\.game-room \.game-speech-presets\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);/);
  });
});
