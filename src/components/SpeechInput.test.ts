import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect } from 'vitest';
import SpeechInput, { speechPlaceholder } from './SpeechInput';

const responsiveCss = readFileSync(new URL('../styles/game-responsive.css', import.meta.url), 'utf8');

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

  it('gives every quick-speech preset a wrapping 44px target', () => {
    const html = renderToStaticMarkup(React.createElement(SpeechInput, {
      value: '',
      onChange: () => undefined,
      onSubmit: () => undefined,
      visible: true,
      selectedPlayer: null,
    }));

    expect(html).toContain('class="game-speech-input mt-4 flex flex-col gap-2"');
    expect(html).toContain('class="game-speech-presets flex flex-wrap gap-1.5"');
    expect(html.match(/game-quick-speech-button/g)).toHaveLength(7);
    expect(responsiveCss).toMatch(/\.game-quick-speech-button\s*\{[\s\S]*?min-height:\s*44px;[\s\S]*?white-space:\s*normal;/);
    expect(responsiveCss).toMatch(/@media \(min-width: 1024px\)\s*\{[\s\S]*?\.game-room \.game-speech-presets\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);[\s\S]*?row-gap:\s*4px;/);
    expect(responsiveCss).toMatch(/\.game-room \.game-speech-input\s*\{[\s\S]*?margin-top:\s*12px;/);
  });
});
