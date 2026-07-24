import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import UnavailableNotice from './UnavailableNotice';

describe('UnavailableNotice', () => {
  it('renders an accessible return path and a native-disabled action', () => {
    const html = renderToStaticMarkup(
      <UnavailableNotice title="Live Multiplayer" description="Live services are not connected." onBack={() => undefined} />,
    );
    expect(html).toContain('Live Multiplayer');
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain('disabled=""');
  });
});
