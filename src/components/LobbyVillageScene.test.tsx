import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SKIN_CATALOG } from '../economy/catalog';
import LobbyHome from './LobbyHome';
import LobbyVillageScene from './LobbyVillageScene';

describe('lobby equipped character', () => {
  it('falls back to the seated traveler when no supported skin is equipped', () => {
    for (const equippedSkin of [null, { ...SKIN_CATALOG[0], id: 'retired-skin' }]) {
      const html = renderToStaticMarkup(<LobbyVillageScene equippedSkin={equippedSkin} />);
      expect(html).toContain('data-equipped-skin="default"');
      expect(html).toContain('night-traveler-cape');
      expect(html).toContain('data-pose="seated"');
      expect(html).toContain('data-part="grounded-hips"');
      expect(html).not.toContain('wuxia-character');
    }
  });

  it.each(SKIN_CATALOG)('passes the equipped $id through the active lobby to shared artwork', product => {
    const noop = () => undefined;
    const html = renderToStaticMarkup(<LobbyHome
      onStartGame={noop} onOpenSubview={noop} onOpenUtilityMenu={noop} onNavigate={noop}
      onOpenTidalStore={noop} onOpenQualifier={noop} onOpenDailyCheckIn={noop}
      onOpenTutorial={noop} identityName="Traveler" identityHandle="@traveler"
      isGuest onSignIn={noop} equippedSkin={product}
    />);
    expect(html).toContain(`data-equipped-skin="${product.id}"`);
    expect(html).toContain(`data-skin-id="${product.id}"`);
    expect(html).toContain('data-pose="seated"');
    expect(html).toContain('data-part="grounded-sword"');
    expect(html).toContain('data-part="grounded-hips"');
    expect(html).not.toContain('night-traveler-cape');
    expect(html).not.toContain('<image');
    expect(html).not.toContain('<filter');
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    for (const ref of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(ref[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
