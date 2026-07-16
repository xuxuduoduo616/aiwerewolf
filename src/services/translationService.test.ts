import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TRANSLATION_ENDPOINT,
  clearTranslationCache,
  detectLanguage,
  needsTranslation,
  translateLogText,
} from './translationService';

const stubFetch = (impl?: () => Promise<unknown>) => {
  const fetchMock = vi.fn(
    impl ?? (async () => ({ ok: true, json: async () => ({ text: '翻译结果' }) })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => {
  clearTranslationCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('detectLanguage', () => {
  it('detects Japanese via kana even when kanji is present', () => {
    expect(detectLanguage('そうだね、3号が怪しいと思う。')).toBe('ja');
    expect(detectLanguage('オオカミはあの人だ')).toBe('ja');
  });

  it('detects Chinese via CJK ratio', () => {
    expect(detectLanguage('我觉得3号很可疑，昨晚的发言有问题。')).toBe('zh');
  });

  it('detects English via ASCII dominance', () => {
    expect(detectLanguage('I think Player 3 is suspicious.')).toBe('en');
  });

  it('returns unknown for empty or non-alphabetic text', () => {
    expect(detectLanguage('')).toBe('unknown');
    expect(detectLanguage('   ')).toBe('unknown');
    expect(detectLanguage('。。。')).toBe('unknown');
  });
});

describe('needsTranslation (routing)', () => {
  const ja = 'そうだね、3号が怪しいと思う。';
  const zh = '我觉得3号很可疑。';
  const en = 'I think Player 3 is suspicious.';

  it('routes Japanese text to translation for both zh and en', () => {
    expect(needsTranslation(ja, 'zh')).toBe(true);
    expect(needsTranslation(ja, 'en')).toBe(true);
  });

  it('does not translate text already in the display language', () => {
    expect(needsTranslation(zh, 'zh')).toBe(false);
    expect(needsTranslation(en, 'en')).toBe(false);
  });

  it('translates across zh/en mismatch', () => {
    expect(needsTranslation(zh, 'en')).toBe(true);
    expect(needsTranslation(en, 'zh')).toBe(true);
  });

  it('never translates undetectable text', () => {
    expect(needsTranslation('', 'zh')).toBe(false);
    expect(needsTranslation('。。。', 'en')).toBe(false);
  });
});

describe('translateLogText', () => {
  const ja = 'そうだね、3号が怪しいと思う。';

  it('translates mismatched text through the proxy endpoint', async () => {
    const fetchMock = stubFetch();
    const result = await translateLogText('log-1', ja, 'zh');
    expect(result).toBe('翻译结果');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(TRANSLATION_ENDPOINT, expect.any(Object));
  });

  it('does not fetch when the text already matches the display language', async () => {
    const fetchMock = stubFetch();
    const result = await translateLogText('log-2', 'I agree with Player 5.', 'en');
    expect(result).toBe('I agree with Player 5.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caches by log-entry id — same entry is never fetched twice', async () => {
    const fetchMock = stubFetch();
    const first = await translateLogText('log-3', ja, 'zh');
    const second = await translateLogText('log-3', ja, 'zh');
    expect(first).toBe('翻译结果');
    expect(second).toBe('翻译结果');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent requests for the same entry', async () => {
    const fetchMock = stubFetch();
    const [first, second] = await Promise.all([
      translateLogText('log-4', ja, 'zh'),
      translateLogText('log-4', ja, 'zh'),
    ]);
    expect(first).toBe('翻译结果');
    expect(second).toBe('翻译结果');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches separately for different log entries', async () => {
    const fetchMock = stubFetch();
    await translateLogText('log-5', ja, 'zh');
    await translateLogText('log-6', ja, 'zh');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns the original text when fetch fails, and caches the failure', async () => {
    const fetchMock = stubFetch(async () => { throw new Error('network down'); });
    const first = await translateLogText('log-7', ja, 'zh');
    const second = await translateLogText('log-7', ja, 'zh');
    expect(first).toBe(ja);
    expect(second).toBe(ja);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the original text on a non-ok response', async () => {
    stubFetch(async () => ({ ok: false, json: async () => ({}) }));
    expect(await translateLogText('log-8', ja, 'zh')).toBe(ja);
  });

  it('returns the original text on an empty proxy result', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ text: '' }) }));
    expect(await translateLogText('log-9', ja, 'zh')).toBe(ja);
  });

  it('never fetches in local Vite dev (proxy unavailable)', async () => {
    const fetchMock = stubFetch();
    vi.stubGlobal('window', { location: { port: '5173' } });
    expect(await translateLogText('log-10', ja, 'zh')).toBe(ja);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
