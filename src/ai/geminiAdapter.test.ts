import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateActionWithLLM,
  generateSpeechWithLLM,
  generateWithGemini,
} from './geminiAdapter';

const PROVIDER_ADAPTER = '/.netlify/functions/provider-adapter';
const GENAI_PROXY = '/.netlify/functions/genai-proxy';

const okResponse = (body: unknown) => ({
  ok: true,
  json: async () => body,
});

const errorResponse = (status: number) => ({
  ok: false,
  status,
  json: async () => ({ error: 'nope' }),
});

const req = { systemPrompt: 'SYS', userPrompt: 'USER' };
const expectedPrompt = 'SYS\n\n---\nUSER';

// The exact request body the legacy genai-proxy path must always receive
// (byte-identical to the pre-routing implementation).
const legacyProxyBody = {
  model: 'gemini-2.5-flash',
  prompt: expectedPrompt,
  responseMimeType: 'application/json',
  temperature: 0.95,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generateWithGemini routing chain', () => {
  it('targets provider-adapter first with a requested route and returns its text', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ text: 'adapter says hi', model_used: 'gemini-2.5-flash' }));

    const result = await generateWithGemini(req);

    expect(result).toBe('adapter says hi');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(PROVIDER_ADAPTER);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      provider: 'gemini-2.5-flash',
      prompt: expectedPrompt,
      responseMimeType: 'application/json',
      temperature: 0.95,
    });
  });

  it('falls back to genai-proxy with the exact legacy body when provider-adapter 404s', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(404))
      .mockResolvedValueOnce(okResponse({ text: 'proxy result' }));

    const result = await generateWithGemini(req);

    expect(result).toBe('proxy result');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(PROVIDER_ADAPTER);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe(GENAI_PROXY);
    expect(JSON.parse(init.body)).toEqual(legacyProxyBody);
  });

  it('falls back to genai-proxy when provider-adapter throws a network error', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(okResponse({ text: 'proxy result' }));

    const result = await generateWithGemini(req);

    expect(result).toBe('proxy result');
    expect(fetchMock.mock.calls[1][0]).toBe(GENAI_PROXY);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(legacyProxyBody);
  });

  it('falls back to genai-proxy when provider-adapter returns the empty local-fallback signal', async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ text: '', model_used: 'local-fallback', fallback_used: true }))
      .mockResolvedValueOnce(okResponse({ text: 'proxy result' }));

    const result = await generateWithGemini(req);

    expect(result).toBe('proxy result');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(GENAI_PROXY);
  });

  it("returns '' when both endpoints fail (speech library takes over)", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(500));

    expect(await generateWithGemini(req)).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns '' when both endpoints throw network errors", async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));

    expect(await generateWithGemini(req)).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns '' when response JSON has no text field", async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse({ nope: true }))
      .mockResolvedValueOnce(okResponse({ nope: true }));

    expect(await generateWithGemini(req)).toBe('');
  });

  it('forwards a custom temperature to both endpoints', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(404))
      .mockResolvedValueOnce(okResponse({ text: 'ok' }));

    await generateWithGemini({ ...req, temperature: 0.3 });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).temperature).toBe(0.3);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).temperature).toBe(0.3);
  });
});

describe('local Vite guard', () => {
  it.each(['5173', '4173', '4174', '4175'])(
    "makes zero network calls and returns '' on Vite port %s",
    async (port) => {
      vi.stubGlobal('window', { location: { port } });

      expect(await generateWithGemini(req)).toBe('');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('does call the network on a non-dev port', async () => {
    vi.stubGlobal('window', { location: { port: '443' } });
    fetchMock.mockResolvedValueOnce(okResponse({ text: 'prod' }));

    expect(await generateWithGemini(req)).toBe('prod');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('fetch timeout wiring (night-pipeline-exception-safety)', () => {
  it('passes a 12s bounded AbortSignal to every fetch', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    fetchMock
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(okResponse({ text: 'ok' }));

    await generateWithGemini(req);

    expect(timeoutSpy).toHaveBeenCalledWith(12000);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    timeoutSpy.mockRestore();
  });

  it('omits the signal when AbortSignal.timeout is unavailable (older browsers)', async () => {
    const original = AbortSignal.timeout;
    // Simulate an older browser without static AbortSignal.timeout.
    (AbortSignal as unknown as { timeout?: unknown }).timeout = undefined;
    try {
      fetchMock.mockResolvedValueOnce(okResponse({ text: 'ok' }));

      expect(await generateWithGemini(req)).toBe('ok');
      expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
    } finally {
      AbortSignal.timeout = original;
    }
  });

  it("returns '' when the fetch aborts on timeout (speech library takes over)", async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));

    expect(await generateWithGemini(req)).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('caller-facing failure contract (aiOrchestrator consumers)', () => {
  it('generateSpeechWithLLM returns parsed zh/en on success', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ text: '{"zh":"你好","en":"Hello"}' }));

    expect(await generateSpeechWithLLM('SYS', 'CTX')).toEqual({ zh: '你好', en: 'Hello' });
  });

  it('generateSpeechWithLLM returns null when the whole chain fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));

    expect(await generateSpeechWithLLM('SYS', 'CTX')).toBeNull();
  });

  it('generateActionWithLLM returns a valid target on success', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ text: '{"targetId":3,"reason":"可疑"}' }));

    expect(await generateActionWithLLM('prompt', [1, 3, 5])).toEqual({ targetId: 3, reason: '可疑' });
  });

  it('generateActionWithLLM returns null target when the whole chain fails', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));

    expect(await generateActionWithLLM('prompt', [1, 3, 5])).toEqual({ targetId: null });
  });

  it('generateActionWithLLM rejects targets outside the valid list', async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ text: '{"targetId":9}' }));

    expect(await generateActionWithLLM('prompt', [1, 3, 5])).toEqual({ targetId: null });
  });
});
