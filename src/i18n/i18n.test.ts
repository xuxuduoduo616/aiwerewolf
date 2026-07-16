import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DISPLAY_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  isCannedEnglishStub,
  loadDisplayLanguage,
  nextDisplayLanguage,
  pickLogText,
  pickTranslationSource,
  saveDisplayLanguage,
} from './index';

const stubLocalStorage = () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  });
  return store;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('display language persistence', () => {
  it('defaults to zh when nothing is stored', () => {
    stubLocalStorage();
    expect(loadDisplayLanguage()).toBe(DEFAULT_DISPLAY_LANGUAGE);
    expect(DEFAULT_DISPLAY_LANGUAGE).toBe('zh');
  });

  it('persists the choice and restores it (survives reload)', () => {
    const store = stubLocalStorage();
    saveDisplayLanguage('en');
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(loadDisplayLanguage()).toBe('en');
    saveDisplayLanguage('zh');
    expect(loadDisplayLanguage()).toBe('zh');
  });

  it('falls back to the default on an invalid stored value', () => {
    const store = stubLocalStorage();
    store.set(LANGUAGE_STORAGE_KEY, 'ja');
    expect(loadDisplayLanguage()).toBe(DEFAULT_DISPLAY_LANGUAGE);
  });

  it('does not throw when localStorage is unavailable', () => {
    // node environment: no localStorage global at all
    expect(loadDisplayLanguage()).toBe(DEFAULT_DISPLAY_LANGUAGE);
    expect(() => saveDisplayLanguage('en')).not.toThrow();
  });
});

describe('nextDisplayLanguage', () => {
  it('toggles between zh and en', () => {
    expect(nextDisplayLanguage('zh')).toBe('en');
    expect(nextDisplayLanguage('en')).toBe('zh');
  });
});

describe('pickLogText (bilingual fields)', () => {
  const log = { message: 'Night falls.', translation: '天黑请闭眼。' };

  it('picks the Chinese translation field for zh', () => {
    expect(pickLogText(log, 'zh')).toBe('天黑请闭眼。');
  });

  it('picks the English message field for en', () => {
    expect(pickLogText(log, 'en')).toBe('Night falls.');
  });

  it('falls back to message when a translation is missing', () => {
    expect(pickLogText({ message: 'Hello there.' }, 'zh')).toBe('Hello there.');
  });
});

describe('isCannedEnglishStub (fallback stub detection)', () => {
  it('matches the known canned fallback stubs exactly', () => {
    expect(isCannedEnglishStub('Speaks based on game situation.')).toBe(true);
    expect(isCannedEnglishStub('Frames Player 3.')).toBe(true);
    expect(isCannedEnglishStub('Frames Player ?.')).toBe(true);
    expect(isCannedEnglishStub('Pushes suspicion on Player 12.')).toBe(true);
    expect(isCannedEnglishStub('Pushes suspicion on Player ?.')).toBe(true);
    expect(isCannedEnglishStub('Seer reports: Player 4 is GOOD.')).toBe(true);
    expect(isCannedEnglishStub('Seer reports: Player 12 is WOLF.')).toBe(true);
  });

  it('never matches genuine English speech', () => {
    expect(isCannedEnglishStub('I think Player 3 is suspicious.')).toBe(false);
    expect(isCannedEnglishStub('Seer reports: Player 4 is probably GOOD, trust me.')).toBe(false);
    expect(isCannedEnglishStub('Pushes suspicion on Player 3 because he lied.')).toBe(false);
    expect(isCannedEnglishStub('He frames Player 3.')).toBe(false);
    expect(isCannedEnglishStub('')).toBe(false);
  });
});

describe('pickTranslationSource (stub → zh original in EN mode)', () => {
  const zh = '我觉得3号很可疑，昨晚的发言有问题。';

  it('uses the zh original when the en field is a canned stub', () => {
    const log = { message: 'Speaks based on game situation.', translation: zh, isSystem: false };
    expect(pickTranslationSource(log, 'en')).toBe(zh);
  });

  it('uses the zh original for the canned Seer report stub', () => {
    const seerZh = '我是预言家，昨晚验了4号，结果是金水/好人。今天先围绕这个结果盘逻辑。';
    const log = { message: 'Seer reports: Player 4 is GOOD.', translation: seerZh, isSystem: false };
    expect(pickTranslationSource(log, 'en')).toBe(seerZh);
  });

  it('uses the zh original when the en field is missing', () => {
    const log = { message: '', translation: zh, isSystem: false };
    expect(pickTranslationSource(log, 'en')).toBe(zh);
  });

  it('keeps genuine English speech untouched', () => {
    const log = { message: 'I think Player 3 is suspicious.', translation: zh, isSystem: false };
    expect(pickTranslationSource(log, 'en')).toBe('I think Player 3 is suspicious.');
  });

  it('keeps the stub when no zh original exists (nothing better to show)', () => {
    const log = { message: 'Frames Player 3.', isSystem: false };
    expect(pickTranslationSource(log, 'en')).toBe('Frames Player 3.');
  });

  it('does not affect system messages', () => {
    const log = { message: 'Speaks based on game situation.', translation: zh, isSystem: true };
    expect(pickTranslationSource(log, 'en')).toBe('Speaks based on game situation.');
  });

  it('does not affect zh mode (matches pickLogText)', () => {
    const log = { message: 'Frames Player 5.', translation: zh, isSystem: false };
    expect(pickTranslationSource(log, 'zh')).toBe(zh);
    expect(pickTranslationSource(log, 'zh')).toBe(pickLogText(log, 'zh'));
  });
});
