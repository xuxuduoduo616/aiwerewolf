import { describe, it, expect } from 'vitest';
import { actionLabel, type ActionLabelKey } from './ActionBar';

// Owner-specified label table (task card action-bar-i18n).
const EXPECTED: Record<ActionLabelKey, string> = {
  KILL: 'KILL',
  CHECK: 'CHECK',
  SAVE: 'SAVE',
  POISON: 'POISON',
  PASS: 'PASS',
  SHOOT: 'SHOOT',
  VOTE: 'VOTE',
  NO_VOTE: 'NO VOTE',
};

const KEYS = Object.keys(EXPECTED) as ActionLabelKey[];

describe('ActionBar actionLabel', () => {
  it('covers all eight action keys', () => {
    expect(KEYS).toHaveLength(8);
  });

  it.each(KEYS)('renders the English label for %s when stored language is zh', key => {
    expect(actionLabel(key, 'zh')).toBe(EXPECTED[key]);
  });

  it.each(KEYS)('renders the English label for %s when language is en', key => {
    expect(actionLabel(key, 'en')).toBe(EXPECTED[key]);
  });
});
