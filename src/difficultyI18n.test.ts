import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_CONFIGS,
  Difficulty,
  difficultyDescription,
  difficultyLabel,
} from './types';

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

describe('difficulty config i18n fields', () => {
  it('all three difficulties have non-empty English label and description', () => {
    for (const d of DIFFICULTIES) {
      expect(DIFFICULTY_CONFIGS[d].labelEn.length).toBeGreaterThan(0);
      expect(DIFFICULTY_CONFIGS[d].descriptionEn.length).toBeGreaterThan(0);
    }
  });

  it('maps zh labels to the required English labels', () => {
    expect(DIFFICULTY_CONFIGS.easy.label).toBe('新手');
    expect(DIFFICULTY_CONFIGS.easy.labelEn).toBe('Beginner');
    expect(DIFFICULTY_CONFIGS.normal.label).toBe('进阶');
    expect(DIFFICULTY_CONFIGS.normal.labelEn).toBe('Intermediate');
    expect(DIFFICULTY_CONFIGS.hard.label).toBe('高手');
    expect(DIFFICULTY_CONFIGS.hard.labelEn).toBe('Expert');
  });

  it('keeps numeric difficulty parameters intact', () => {
    expect(DIFFICULTY_CONFIGS.easy.actionAccuracy).toBe(0.45);
    expect(DIFFICULTY_CONFIGS.normal.actionAccuracy).toBe(0.72);
    expect(DIFFICULTY_CONFIGS.hard.actionAccuracy).toBe(0.92);
  });
});

describe('difficultyLabel / difficultyDescription pickers', () => {
  it('returns the zh fields for language zh (3 difficulties)', () => {
    for (const d of DIFFICULTIES) {
      const config = DIFFICULTY_CONFIGS[d];
      expect(difficultyLabel(config, 'zh')).toBe(config.label);
      expect(difficultyDescription(config, 'zh')).toBe(config.description);
    }
  });

  it('returns the en fields for language en (3 difficulties)', () => {
    for (const d of DIFFICULTIES) {
      const config = DIFFICULTY_CONFIGS[d];
      expect(difficultyLabel(config, 'en')).toBe(config.labelEn);
      expect(difficultyDescription(config, 'en')).toBe(config.descriptionEn);
    }
  });
});
