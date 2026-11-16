import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import SkinCollectionPanel, { type SkinCollectionProps } from './SkinCollectionPanel';
import OutfitsPanel from './OutfitsPanel';
import { createEmptyGuestEconomyState } from '../economy/ledger';

type Economy = NonNullable<SkinCollectionProps['economy']>;
const makeEconomy = (): Economy => ({
  mode: 'guest', phase: 'ready', ledgerCorrupt: false,
  state: { ...createEmptyGuestEconomyState(), serverDate: null, guestEvents: [], accountLedger: [], accountCatalog: [], nextCursor: null },
  statusMessage: '', feedback: '', mutationsDisabled: false, pendingAction: null,
  refresh: vi.fn(), equipSkin: vi.fn(),
});

describe('verified profile wardrobe', () => {
  it('includes the original permanently, without fabricated launch outfits or collection totals', () => {
    const economy = makeEconomy();
    const html = renderToStaticMarkup(<SkinCollectionPanel economy={economy} />);
    expect(html).toContain('1 owned · including Default Outfit');
    expect(html).toContain('Free · Always owned');
    expect(html).toContain('is-equipped');
    expect(html).not.toContain('Launch Celebration');
    expect(html).not.toContain('137');
  });

  it('shows purchased skins and the actual equipment identically under Outfits and Skins', () => {
    const economy = makeEconomy();
    economy.state.inventory = ['skin:mist-wanderer', 'avatar-frame:ink-ring'];
    economy.state.equippedSkinId = 'mist-wanderer';
    const html = renderToStaticMarkup(<SkinCollectionPanel economy={economy} />);
    expect(html).toContain('2 owned · including Default Outfit');
    expect(html).toContain('data-owned-skin="mist-wanderer"');
    expect(html).not.toContain('Bamboo Vigil');
    expect(html).toContain('disabled="" aria-label="Equip Mist Wanderer"');
    expect(renderToStaticMarkup(<OutfitsPanel economy={economy} />)).toBe(html);
  });

  it('uses verified account catalog names and hides unrecognized assets', () => {
    const economy = makeEconomy();
    economy.mode = 'account';
    economy.state.inventory = ['skin:mist-wanderer', 'skin:bamboo-vigil', 'skin:unknown'];
    economy.state.accountCatalog = [{ id: 'mist-wanderer', name: 'Verified Traveler', assetKey: 'mist-wanderer', itemKind: 'skin', tier: 'basic', currency: 'coins', price: 800, purchaseEnabled: false }];
    const html = renderToStaticMarkup(<SkinCollectionPanel economy={economy} />);
    expect(html).toContain('2 owned · including Default Outfit');
    expect(html).toContain('Verified Traveler');
    expect(html).not.toContain('Bamboo Vigil');
    expect(html).not.toContain('data-owned-skin="unknown"');
    // A retired purchase can still be worn when verified and owned.
    expect(html).toContain('Equip in Lobby');
  });

  it('hides stale ownership on unavailable account state while retaining the original', () => {
    const economy = makeEconomy();
    economy.mode = 'account';
    economy.phase = 'unavailable';
    economy.state.inventory = ['skin:mist-wanderer'];
    economy.state.equippedSkinId = 'mist-wanderer';
    const html = renderToStaticMarkup(<SkinCollectionPanel economy={economy} />);
    expect(html).toContain('Default Outfit');
    expect(html).toContain('Refresh Collection');
    expect(html).not.toContain('Mist Wanderer');
    expect(html).not.toContain('is-equipped');
  });
});
