import React, { useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { UseEconomyResult } from '../hooks/useEconomy';
import { SKIN_CATALOG } from './catalog';
import { resolveEquippedSkinProduct, useEquippedSkinProduct } from './equippedSkin';

type Input = Parameters<typeof resolveEquippedSkinProduct>[0];
const ready = (id: string = SKIN_CATALOG[0].id): Input => ({
  mode: 'guest', phase: 'ready', ledgerCorrupt: false,
  state: {
    coins: 0, crystals: 0, inventory: [`skin:${id}`], equippedSkinId: id,
    checkInStreak: 0, lastCheckInDay: null, serverDate: null, claimedMilestoneDays: [],
    tutorialSeen: true, tutorialFinished: false, guestEvents: [], accountLedger: [], accountCatalog: [], nextCursor: null,
  },
});

describe('equipped cosmetic authority and subject boundaries', () => {
  it.each(SKIN_CATALOG)('resolves an owned guest $id without changing economics', product => {
    const input = ready(product.id);
    const before = JSON.stringify(input);
    expect(resolveEquippedSkinProduct(input)).toEqual(product);
    expect(JSON.stringify(input)).toBe(before);
  });
  it('falls back on unknown, empty or unowned equipment and corrupt ledgers', () => {
    expect(resolveEquippedSkinProduct(ready('unknown'))).toBeNull();
    const input = ready();
    expect(resolveEquippedSkinProduct({ ...input, ledgerCorrupt: true })).toBeNull();
    expect(resolveEquippedSkinProduct({ ...input, state: { ...input.state, inventory: [] } })).toBeNull();
    expect(resolveEquippedSkinProduct({ ...input, state: { ...input.state, equippedSkinId: null } })).toBeNull();
  });
  it.each(['inactive', 'loading', 'unavailable', 'reauthenticate', 'corrupt', 'unverified'] as UseEconomyResult['phase'][])('falls back during account %s even if an old owned snapshot remains', phase => {
    expect(resolveEquippedSkinProduct({ ...ready(), mode: 'account', phase })).toBeNull();
  });
  it('requires a matching current account skin catalog item and preserves its name', () => {
    const input = { ...ready(), mode: 'account' as const };
    expect(resolveEquippedSkinProduct(input)).toBeNull();
    const catalogItem = { id: SKIN_CATALOG[0].id, name: 'Verified server name', itemKind: 'skin' as const, tier: 'basic' as const, currency: 'coins' as const, price: 800, assetKey: 'skins/mist', purchaseEnabled: false };
    const withCatalog = { ...input, state: { ...input.state, accountCatalog: [catalogItem] } };
    expect(resolveEquippedSkinProduct(withCatalog)?.name).toBe('Verified server name');
    expect(resolveEquippedSkinProduct({ ...withCatalog, state: { ...withCatalog.state, inventory: [] } })).toBeNull();
    expect(resolveEquippedSkinProduct({ ...withCatalog, state: { ...withCatalog.state, accountCatalog: [{ ...catalogItem, itemKind: 'avatar_frame' }] } })).toBeNull();
  });
  it('hides a previous subject synchronously before refresh effects run', () => {
    const Probe = () => {
      const [principal, setPrincipal] = useState('guest:first-fixture');
      const transitioned = useRef(false);
      const product = useEquippedSkinProduct(ready(), principal);
      if (!transitioned.current) { transitioned.current = true; expect(product?.id).toBe('mist-wanderer'); setPrincipal('guest:second-fixture'); }
      return React.createElement('output', null, product?.id ?? 'default-avatar');
    };
    expect(renderToStaticMarkup(React.createElement(Probe))).toContain('default-avatar');
  });
  it('does not expose equipment without a current principal', () => {
    const Probe = () => React.createElement('output', null, useEquippedSkinProduct(ready(), null)?.id ?? 'default-avatar');
    expect(renderToStaticMarkup(React.createElement(Probe))).toContain('default-avatar');
  });
});
