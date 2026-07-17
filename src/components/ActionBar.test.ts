import { describe, it, expect } from 'vitest';
import { actionLabel, type ActionLabelKey } from './ActionBar';
import type { DisplayLanguage } from '../i18n';

// Owner-specified label table (task card action-bar-i18n).
const EXPECTED: Record<ActionLabelKey, Record<DisplayLanguage, string>> = {
  KILL: { zh: '刀人', en: 'KILL' },
  CHECK: { zh: '查验', en: 'CHECK' },
  SAVE: { zh: '救人', en: 'SAVE' },
  POISON: { zh: '毒药', en: 'POISON' },
  PASS: { zh: '跳过', en: 'PASS' },
  SHOOT: { zh: '开枪', en: 'SHOOT' },
  VOTE: { zh: '投票', en: 'VOTE' },
  NO_VOTE: { zh: '弃票', en: 'NO VOTE' },
};

const KEYS = Object.keys(EXPECTED) as ActionLabelKey[];

describe('ActionBar actionLabel', () => {
  it('covers all eight action keys', () => {
    expect(KEYS).toHaveLength(8);
  });

  it.each(KEYS)('renders the Chinese label for %s when language is zh', key => {
    expect(actionLabel(key, 'zh')).toBe(EXPECTED[key].zh);
  });

  it.each(KEYS)('renders the English label for %s when language is en', key => {
    expect(actionLabel(key, 'en')).toBe(EXPECTED[key].en);
  });
});
