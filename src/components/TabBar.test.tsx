import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TabBar, { getNextTabIndex } from './TabBar';

const TABS = [
  { key: 'one' as const, label: 'One' },
  { key: 'two' as const, label: 'Two' },
  { key: 'three' as const, label: 'Three' },
];

describe('TabBar', () => {
  it('renders a labelled tablist with selected state and panel relationships', () => {
    const markup = renderToStaticMarkup(
      <TabBar id="example" label="Example tabs" tabs={TABS} active="two" onSelect={vi.fn()} />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Example tabs"');
    expect(markup).toContain('id="example-tab-two"');
    expect(markup).toContain('aria-controls="example-panel-two"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('tabindex="0"');
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(2);
  });

  it('supports wrapping arrow keys plus Home and End', () => {
    expect(getNextTabIndex(2, 3, 'ArrowRight')).toBe(0);
    expect(getNextTabIndex(0, 3, 'ArrowLeft')).toBe(2);
    expect(getNextTabIndex(1, 3, 'Home')).toBe(0);
    expect(getNextTabIndex(1, 3, 'End')).toBe(2);
    expect(getNextTabIndex(1, 3, 'Enter')).toBeNull();
  });
});
