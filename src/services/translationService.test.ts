import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickTranslationSource } from '../i18n';
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

// Mirrors LogMessage's EN-mode stub path: pickTranslationSource swaps a canned
// English stub for the zh original, which then flows through translateLogText.
describe('EN display stub path (pickTranslationSource + translateLogText)', () => {
  const zh = '我觉得3号很可疑，昨晚的发言有问题。';
  const stubLog = { message: 'Speaks based on game situation.', translation: zh, isSystem: false };

  it('replaces the stub with a translation of the zh original on success', async () => {
    const fetchMock = stubFetch(async () => ({
      ok: true,
      json: async () => ({ text: 'I think Player 3 is suspicious after last night.' }),
    }));
    const source = pickTranslationSource(stubLog, 'en');
    expect(source).toBe(zh);
    const result = await translateLogText('stub-1', source, 'en');
    expect(result).toBe('I think Player 3 is suspicious after last night.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toContain(zh);
  });

  it('falls back to the zh original (not the stub) when the proxy fails', async () => {
    stubFetch(async () => { throw new Error('network down'); });
    const source = pickTranslationSource(stubLog, 'en');
    expect(await translateLogText('stub-2', source, 'en')).toBe(zh);
  });

  it('shows the zh original in local Vite dev without fetching', async () => {
    const fetchMock = stubFetch();
    vi.stubGlobal('window', { location: { port: '5173' } });
    const source = pickTranslationSource(stubLog, 'en');
    expect(await translateLogText('stub-3', source, 'en')).toBe(zh);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not re-translate genuine English speech', async () => {
    const fetchMock = stubFetch();
    const realLog = { message: 'I think Player 3 is suspicious.', translation: zh, isSystem: false };
    const source = pickTranslationSource(realLog, 'en');
    expect(source).toBe('I think Player 3 is suspicious.');
    expect(await translateLogText('stub-4', source, 'en')).toBe('I think Player 3 is suspicious.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps per-log-id cache dedup on the stub path', async () => {
    const fetchMock = stubFetch(async () => ({ ok: true, json: async () => ({ text: 'Translated.' }) }));
    const source = pickTranslationSource(stubLog, 'en');
    const [first, second] = await Promise.all([
      translateLogText('stub-5', source, 'en'),
      translateLogText('stub-5', source, 'en'),
    ]);
    expect(await translateLogText('stub-5', source, 'en')).toBe('Translated.');
    expect(first).toBe('Translated.');
    expect(second).toBe('Translated.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * ai-speech-roster-name-fix — H5 translation referent protection
 * (fix invariants 4 and 5).
 */
describe('translateLogText — referent protection (H5)', () => {
  const ja = 'そうだね、3号が怪しいと思う。';

  it('enumerates the source seat references as protected tokens in the prompt', async () => {
    const fetchMock = stubFetch(async () => ({
      ok: true,
      json: async () => ({ text: 'I think Player 3 is suspicious.' }),
    }));
    await translateLogText('guard-1', ja, 'en');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.prompt).toContain('Protected player references');
    expect(body.prompt).toContain('3号/Player 3');
    expect(body.prompt).toContain('Never introduce any player number or personal name');
  });

  it('accepts a translation that preserves the referents', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ text: 'I think Player 3 is suspicious.' }),
    }));
    expect(await translateLogText('guard-2', ja, 'en')).toBe('I think Player 3 is suspicious.');
  });

  it('falls back to the original text when the translation rewrites a seat referent', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ text: 'I suspect Player 5 today.' }),
    }));
    expect(await translateLogText('guard-3', ja, 'en')).toBe(ja);
  });

  it('falls back to the original text when the translation introduces a foreign name or Agent ref', async () => {
    stubFetch(async () => ({
      ok: true,
      json: async () => ({ text: 'I suspect Player 3 — Sakura keeps lying about Agent[03].' }),
    }));
    expect(await translateLogText('guard-4', ja, 'en')).toBe(ja);
  });

  it('isolates the cache by language for the same log entry (invariant 5)', async () => {
    const fetchMock = stubFetch(async () => ({
      ok: true,
      json: async () => ({ text: '翻译结果' }),
    }));
    await translateLogText('guard-5', ja, 'zh');
    await translateLogText('guard-5', ja, 'en'); // same id, different language → separate fetch
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
