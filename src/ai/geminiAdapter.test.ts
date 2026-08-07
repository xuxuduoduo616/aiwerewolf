import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSpeechWithLLM, generateWithGemini } from './geminiAdapter';

const endpoint = '/.netlify/functions/provider-adapter';
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('browser expression adapter', () => {
  it('makes one POST only and lets the server own fallback', async () => {
    fetchMock.mockResolvedValue(response({ text: 'one response', model_used: 'gemini-2.5-flash', fallback_used: true }));
    await expect(generateWithGemini({ systemPrompt: 'S', userPrompt: 'U' }, 'gemini-3.6-flash')).resolves.toBe('one response');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(endpoint);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ model: 'gemini-3.6-flash', prompt: 'S\n\n---\nU', responseMimeType: 'application/json' });
  });
  it('returns empty text on server, network, timeout, and malformed failures without a second POST', async () => {
    for (const next of [response({}, true), response({}, false), new Error('offline')]) {
      fetchMock.mockReset(); typeof next === 'object' && next instanceof Error ? fetchMock.mockRejectedValue(next) : fetchMock.mockResolvedValue(next);
      await expect(generateWithGemini({ systemPrompt: 'S', userPrompt: 'U' })).resolves.toBe('');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
  it('parses a JSON speech payload and rejects non-speech payloads', async () => {
    fetchMock.mockResolvedValueOnce(response({ text: '{"zh":"你好","en":"hello"}' }));
    await expect(generateSpeechWithLLM('S', 'U')).resolves.toEqual({ zh: '你好', en: 'hello' });
    fetchMock.mockResolvedValueOnce(response({ text: '{"en":"only"}' }));
    await expect(generateSpeechWithLLM('S', 'U')).resolves.toBeNull();
  });
});
