import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SKIN_CATALOG } from '../economy/catalog';
import LobbyHome from './LobbyHome';
import LobbyVillageScene from './LobbyVillageScene';

describe('lobby ink-wash vista scene', () => {
  it('renders the open ink-wash vista without legacy stick-figure artwork by default', () => {
    for (const equippedSkin of [null, { ...SKIN_CATALOG[0], id: 'retired-skin' }]) {
      const html = renderToStaticMarkup(<LobbyVillageScene equippedSkin={equippedSkin} />);
      expect(html).toContain('data-equipped-skin="default"');
      expect(html).toContain('data-scene-stage="ink-vista"');
      expect(html).not.toContain('night-traveler-cape');
      expect(html).not.toContain('wuxia-character');
      expect(html).not.toContain('<svg');
    }
  });

  it.each(SKIN_CATALOG)('attunes the lobby vista seal to the equipped $id skin', product => {
    const noop = () => undefined;
    const html = renderToStaticMarkup(<LobbyHome
      onStartGame={noop} onOpenSubview={noop} onOpenUtilityMenu={noop} onNavigate={noop}
      onOpenTidalStore={noop} onOpenQualifier={noop} onOpenDailyCheckIn={noop}
      onOpenTutorial={noop} identityName="Traveler" identityHandle="@traveler"
      isGuest onSignIn={noop} equippedSkin={product}
    />);
    expect(html).toContain(`data-equipped-skin="${product.id}"`);
    expect(html).toContain(`data-skin-id="${product.id}"`);
    expect(html).toContain(product.name);
    expect(html).toContain('data-scene-stage="ink-vista"');
    expect(html).not.toContain('night-traveler-cape');
  });
});
