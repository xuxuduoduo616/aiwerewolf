import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import UtilityView, { UTILITY_CONTENT } from './UtilityView';

describe('utility destinations', () => {
  it.each(Object.entries(UTILITY_CONTENT))('renders a usable %s destination view', (destination, content) => {
    const html = renderToStaticMarkup(
      <UtilityView
        destination={destination as keyof typeof UTILITY_CONTENT}
        displayLanguage="zh"
        onToggleLanguage={() => undefined}
        onBack={() => undefined}
      />,
    );
    expect(html).toContain(content.title);
    expect(html).toContain(content.description);
    expect(html).toContain('aria-label="Return to utility menu"');
  });

  it('provides a local language control in Settings', () => {
    const html = renderToStaticMarkup(
      <UtilityView destination="settings" displayLanguage="en" onToggleLanguage={() => undefined} onBack={() => undefined} />,
    );
    expect(html).toContain('Speech display: English');
    expect(html).not.toContain('disabled=""');
  });

  it('keeps redemption visibly disabled without a wallet or network action', () => {
    const html = renderToStaticMarkup(
      <UtilityView destination="redeem-code" displayLanguage="zh" onToggleLanguage={() => undefined} onBack={() => undefined} />,
    );
    expect(html).toContain('Redemption is not connected');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
});
