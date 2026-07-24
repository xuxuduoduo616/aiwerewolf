import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import TopStatusBar from './TopStatusBar';
import UtilityMenu, { UTILITY_DESTINATIONS, isUtilityDestination } from './UtilityMenu';

describe('Gear utility menu', () => {
  it('exposes the exact eight destinations in stable order', () => {
    expect(UTILITY_DESTINATIONS.map(item => item.id)).toEqual([
      'settings',
      'announcements',
      'mail',
      'support',
      'help',
      'user-center',
      'redeem-code',
      'about',
    ]);
    expect(UTILITY_DESTINATIONS).toHaveLength(8);
    for (const item of UTILITY_DESTINATIONS) expect(isUtilityDestination(item.id)).toBe(true);
    expect(isUtilityDestination('unknown')).toBe(false);
  });

  it('renders every destination as a keyboard-native button', () => {
    const html = renderToStaticMarkup(<UtilityMenu onSelect={() => undefined} onBack={() => undefined} />);
    for (const label of ['Settings', 'Announcements', 'Mail', 'Support', 'Help', 'User Center', 'Redeem Code', 'About']) {
      expect(html).toContain(label);
    }
    expect(html.match(/<button/g)).toHaveLength(9);
    expect(html.match(/disabled=""/g)).toBeNull();
  });

  it('binds a compact top-bar Gear trigger with a stable accessible name', () => {
    const html = renderToStaticMarkup(
      <TopStatusBar coins={0} coupons={0} crystals={0} onOpenUtilityMenu={() => undefined} />,
    );
    expect(html).toContain('class="wol-utility-trigger"');
    expect(html).toContain('aria-label="Open utility menu"');
    expect(html).toContain('aria-haspopup="menu"');
  });
});
