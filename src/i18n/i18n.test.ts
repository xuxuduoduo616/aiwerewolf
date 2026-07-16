import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DISPLAY_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  loadDisplayLanguage,
  nextDisplayLanguage,
  pickLogText,
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
