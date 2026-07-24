import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import SpeechInput, { speechPlaceholder } from './SpeechInput';

describe('speechPlaceholder', () => {
  it('keeps interface copy English when stored speech language is zh', () => {
    expect(speechPlaceholder('zh')).toBe('Your turn to speak...');
  });

  it('returns the English placeholder in en mode', () => {
    expect(speechPlaceholder('en')).toBe('Your turn to speak...');
  });
});

describe('SpeechInput layout', () => {
  it('allows the input row to wrap and shrink at effective 200% zoom', () => {
    const html = renderToStaticMarkup(React.createElement(SpeechInput, {
      value: 'User-authored speech',
      onChange: () => undefined,
      onSubmit: () => undefined,
      visible: true,
      selectedPlayer: null,
    }));

    expect(html).toContain('class="flex w-full min-w-0 flex-wrap gap-2"');
    expect(html).toContain('class="min-w-0 flex-[1_1_8rem]');
    expect(html).toContain('class="action-button shrink-0 px-3"');
    expect(html).toContain('aria-label="Send speech"');
  });
});
