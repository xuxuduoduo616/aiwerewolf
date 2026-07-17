import { describe, it, expect } from 'vitest';
import { speechPlaceholder } from './SpeechInput';

describe('speechPlaceholder', () => {
  it('returns the Chinese placeholder in zh mode', () => {
    expect(speechPlaceholder('zh')).toBe('轮到你发言...');
  });

  it('returns the English placeholder in en mode', () => {
    expect(speechPlaceholder('en')).toBe('Your turn to speak...');
  });
});
