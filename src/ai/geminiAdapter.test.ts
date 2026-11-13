import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSpeechWithLLM, generateWithGemini, generateWolfChatWithLLM } from './geminiAdapter';
import { endMatch, reset, snapshot, startMatch } from '../services/matchTelemetry';

const endpoint = '/.netlify/functions/provider-adapter';
const response = (body: unknown, ok = true) => ({ ok, json: async () => body });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock); reset(); });
afterEach(() => { vi.unstubAllGlobals(); reset(); });

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
    await expect(generateSpeechWithLLM('S', 'U')).resolves.toEqual({ en: 'only', zh: '' });
  });
});

const startTelemetry = () =>
  startMatch({ boardId: '9-standard', difficulty: 'normal', language: 'en', isGuest: true });
const currentTelemetry = () => snapshot().current!;

describe('browser expression telemetry', () => {
  it('counts the server cost estimate and model-chain fallback on success', async () => {
    fetchMock.mockResolvedValueOnce(response({
      text: 'model text', model_used: 'gemini-2.5-flash', cost_estimate: 0.0042, fallback_used: true,
    }));
    startTelemetry();
    await expect(generateWithGemini({ systemPrompt: 'S', userPrompt: 'U' })).resolves.toBe('model text');
    expect(currentTelemetry()).toMatchObject({
      providerRequests: 1, providerSuccesses: 1, providerFailures: 0, providerFallbacks: 0,
    });
    expect(currentTelemetry().providerCostUSD).toBeCloseTo(0.0042, 6);
    expect(currentTelemetry().events.provider_success).toBe(1);
  });

  it('records a non-2xx provider response as provider_failed without cost', async () => {
    fetchMock.mockResolvedValueOnce(response({}, false));
    startTelemetry();
    await expect(generateWithGemini({ systemPrompt: 'S', userPrompt: 'U' })).resolves.toBe('');
    expect(currentTelemetry().events.provider_failed).toBe(1);
    expect(currentTelemetry().providerFailures).toBe(1);
    expect(currentTelemetry().providerCostUSD).toBe(0);
  });

  it.each(['AbortError', 'TimeoutError'])('records a %s rejection as provider_timeout', async (name) => {
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', name));
    startTelemetry();
    await expect(generateWithGemini({ systemPrompt: 'S', userPrompt: 'U' })).resolves.toBe('');
    expect(currentTelemetry().events.provider_timeout).toBe(1);
    expect(currentTelemetry().events.provider_failed).toBe(0);
  });

  it('records malformed JSON and non-string text as provider_unparsable', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError('bad json'); } });
    startTelemetry();
    await expect(generateWithGemini({ systemPrompt: 'S', userPrompt: 'U' })).resolves.toBe('');
    endMatch({ completed: false, phase: 'DAY_DISCUSSION' });

    fetchMock.mockResolvedValueOnce(response({ text: 42 }));
    startTelemetry();
    await expect(generateWithGemini({ systemPrompt: 'S', userPrompt: 'U' })).resolves.toBe('');
    expect(snapshot().matches[0].events.provider_unparsable).toBe(1);
    expect(currentTelemetry().events.provider_unparsable).toBe(1);
  });

  it('records the server local fallback (200, empty text) as provider_failed', async () => {
    fetchMock.mockResolvedValueOnce(response({
      text: '', model_used: 'local-fallback', cost_estimate: 0, fallback_used: true,
    }));
    startTelemetry();
    await expect(generateWithGemini({ systemPrompt: 'S', userPrompt: 'U' })).resolves.toBe('');
    expect(currentTelemetry().events.provider_failed).toBe(1);
    expect(currentTelemetry().providerCostUSD).toBe(0);
  });
});
