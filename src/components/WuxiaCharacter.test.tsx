import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SKIN_CATALOG } from '../economy/catalog';
import WuxiaCharacter, { WUXIA_SKIN_IDS } from './WuxiaCharacter';
import SkinArtwork from './SkinArtwork';

const equipment: Record<string, string[]> = {
  'mist-wanderer': ['straw-rain-cape', 'woven-douli', 'traveler-dao'],
  'bamboo-vigil': ['ranger-hat', 'leather-collar-cuffs', 'sword-scabbard'],
  'tidal-swordsman': ['long-jian', 'tide-headband', 'layered-tide-hem'],
  'moonlit-crane': ['crane-sleeves', 'crane-cape', 'silver-scabbard', 'silver-hair-ornament'],
  'jade-moon-oath': ['jade-moon-clasp', 'ceremonial-crown', 'ceremonial-silk', 'ornamental-sword'],
  'tidebreaker-vow': ['long-broad-dao', 'layered-armor', 'armored-headband'],
  'crimson-lotus-shadow': ['mask-and-leg-wraps', 'short-split-cape', 'slender-assassin-blade'],
};

describe('shared wuxia character assets', () => {
  it('covers the unchanged seven catalog IDs', () => {
    expect([...WUXIA_SKIN_IDS].sort()).toEqual(SKIN_CATALOG.map(product => product.id).sort());
  });
  it.each(SKIN_CATALOG)('draws actual equipment and stick limbs for $id', product => {
    const html = renderToStaticMarkup(<svg><WuxiaCharacter product={product} /></svg>);
    for (const part of equipment[product.id]) expect(html).toContain(`data-equipment="${part}"`);
    expect(html).toContain('data-part="round-head"');
    expect(html).toContain('data-part="stick-limbs"');
    expect(html).not.toContain('<image');
    expect(html).not.toContain('<filter');
  });
  it('keeps defs and references unique with repeated card/dialog instances', () => {
    const html = renderToStaticMarkup(<>{SKIN_CATALOG.flatMap(product => [
      <SkinArtwork key={`${product.id}-card`} product={product} />,
      <SkinArtwork key={`${product.id}-preview`} product={product} large />,
    ])}</>);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    const refs = [...html.matchAll(/url\(#([^)]+)\)/g)].map(match => match[1]);
    expect(ids).toHaveLength(42);
    expect(new Set(ids).size).toBe(ids.length);
    for (const ref of refs) expect(ids).toContain(ref);
    expect(html).not.toContain('feTurbulence');
  });
});
