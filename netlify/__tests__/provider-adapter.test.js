import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const mocks = vi.hoisted(() => ({ GoogleGenAI: vi.fn(), get: vi.fn(), generateContent: vi.fn() }));
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../functions/provider-adapter.cjs'), 'utf8');
const original = { API_KEY: process.env.API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY, ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN, ADAPTER_DRY_RUN: process.env.ADAPTER_DRY_RUN, ADAPTER_DAILY_BUDGET_USD: process.env.ADAPTER_DAILY_BUDGET_USD };
const load = () => {
  const module = { exports: {} };
  const context = vm.createContext({
    Date, Map, JSON, process, Promise, Math, Number, Infinity, URL, setTimeout, clearTimeout,
    require: (id) => id === '@google/genai' ? { GoogleGenAI: mocks.GoogleGenAI, ThinkingLevel: { MINIMAL: 'MINIMAL' } } : (() => { throw new Error(`Unexpected require ${id}`); })(),
    module, exports: module.exports,
  });
  new vm.Script(source).runInContext(context);
  return module.exports;
};
const event = (body = {}, overrides = {}) => ({ httpMethod: 'POST', headers: { origin: 'https://game.example', 'x-nf-client-connection-ip': '198.51.100.11' }, body: JSON.stringify(body), ...overrides });
const json = (response) => JSON.parse(response.body);

describe('Gemini provider adapter', () => {
  beforeEach(() => {
    process.env.API_KEY = 'test-key'; process.env.ALLOWED_ORIGIN = 'https://game.example'; delete process.env.GEMINI_API_KEY; delete process.env.ADAPTER_DRY_RUN; delete process.env.ADAPTER_DAILY_BUDGET_USD;
    mocks.get.mockReset().mockImplementation(({ model }) => Promise.resolve({ name: `models/${model}` }));
    mocks.generateContent.mockReset().mockResolvedValue({ text: 'model text' });
    mocks.GoogleGenAI.mockReset().mockImplementation(() => ({ models: { get: mocks.get, generateContent: mocks.generateContent } }));
  });
  afterEach(() => { for (const [key, value] of Object.entries(original)) value === undefined ? delete process.env[key] : process.env[key] = value; vi.clearAllMocks(); });

  it('has only the two Gemini expression models and local fallback', () => {
    const { MODEL_REGISTRY } = load();
    expect(Object.keys(MODEL_REGISTRY)).toEqual(['gemini-3.6-flash', 'gemini-2.5-flash', 'local-fallback']);
    expect(MODEL_REGISTRY['gemini-3.6-flash'].maxRetries).toBe(0);
    expect(MODEL_REGISTRY['gemini-2.5-flash'].maxRetries).toBe(0);
  });
  it.each([
    ['missing allowlist configuration', () => { delete process.env.ALLOWED_ORIGIN; }, 'https://game.example'],
    ['mismatched Origin', () => { process.env.ALLOWED_ORIGIN = 'https://trusted.example'; }, 'https://game.example'],
  ])('fails closed on %s before capability, model, counters, or billing work', async (_name, setup, origin) => {
    setup();
    const adapter = load();
    const response = await adapter.handler(event({ prompt: 'hello' }, { headers: { origin } }));
    expect(response.statusCode).toBe(403);
    expect(json(response)).toEqual({ error: 'Forbidden' });
    expect(response.headers).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(adapter.getRequestCounters()).toEqual({});
  });
  it('allows an Origin-less same-origin GET only with exact Host and Fetch Metadata evidence', async () => {
    const adapter = load();
    const response = await adapter.handler(event({}, {
      httpMethod: 'GET', body: '', headers: { host: 'game.example', 'sec-fetch-site': 'same-origin' },
    }));
    expect(response.statusCode).toBe(200);
    expect(response.headers['Access-Control-Allow-Origin']).toBe('https://game.example');
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it('rejects an Origin-less request without same-origin evidence before model work', async () => {
    const adapter = load();
    const response = await adapter.handler(event({ prompt: 'hello' }, { headers: { host: 'game.example' } }));
    expect(response.statusCode).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(adapter.getRequestCounters()).toEqual({});
  });
  it('rejects an Origin-less cross-site request even when Host matches', async () => {
    const adapter = load();
    const response = await adapter.handler(event({ prompt: 'hello' }, {
      headers: { host: 'game.example', 'sec-fetch-site': 'cross-site' },
    }));
    expect(response.statusCode).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(adapter.getRequestCounters()).toEqual({});
  });
  it('returns a no-store, exact successful capability catalog and warm-caches success', async () => {
    const adapter = load();
    const first = await adapter.handler(event({}, { httpMethod: 'GET', body: '' }));
    const second = await adapter.handler(event({}, { httpMethod: 'GET', body: '' }));
    expect(json(first)).toMatchObject({ default_model: 'gemini-3.6-flash', models: [{ id: 'gemini-3.6-flash' }, { id: 'gemini-2.5-flash' }] });
    expect(first.headers['Cache-Control']).toBe('no-store');
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(json(second)).toEqual(json(first));
  });
  it.each([
    ['missing key', () => { delete process.env.API_KEY; }],
    ['403', () => { mocks.get.mockRejectedValue(Object.assign(new Error('denied'), { status: 403 })); }],
    ['429', () => { mocks.get.mockRejectedValue(Object.assign(new Error('limited'), { status: 429 })); }],
    ['5xx', () => { mocks.get.mockRejectedValue(Object.assign(new Error('bad upstream'), { status: 503 })); }],
    ['malformed metadata', () => { mocks.get.mockResolvedValue({ name: 'models/not-the-requested-model' }); }],
  ])('fails closed to 2.5 on %s', async (_name, setup) => {
    setup(); const adapter = load(); const response = await adapter.handler(event({}, { httpMethod: 'GET', body: '' }));
    expect(json(response)).toEqual({ default_model: 'gemini-2.5-flash', models: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }] });
  });
  it('fails closed to 2.5 when read-only model lookup times out', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockImplementation(() => new Promise(() => {}));
      const adapter = load();
      const pending = adapter.handler(event({}, { httpMethod: 'GET', body: '' }));
      await vi.advanceTimersByTimeAsync(5000);
      expect(json(await pending).default_model).toBe('gemini-2.5-flash');
    } finally {
      vi.useRealTimers();
    }
  });
  it('uses 3.6 minimal thinking without sampling parameters and reports direct metadata', async () => {
    const adapter = load(); const response = await adapter.handler(event({ model: 'gemini-3.6-flash', prompt: 'hello' }));
    expect(json(response)).toMatchObject({ model_used: 'gemini-3.6-flash', fallback_used: false, text: 'model text' });
    expect(mocks.generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-3.6-flash', config: expect.objectContaining({ thinkingConfig: { thinkingLevel: 'MINIMAL' }, maxOutputTokens: 256 }) }));
    expect(mocks.generateContent.mock.calls[0][0].config).not.toHaveProperty('temperature');
    expect(mocks.generateContent.mock.calls[0][0].config).not.toHaveProperty('topP');
    expect(mocks.generateContent.mock.calls[0][0].config).not.toHaveProperty('topK');
  });
  it('truncates input sent to the SDK at the exported prompt bound', async () => {
    const adapter = load();
    const rawPrompt = 'x'.repeat(adapter.MAX_PROMPT_LEN + 40);
    await adapter.handler(event({ model: 'gemini-3.6-flash', prompt: rawPrompt }));
    expect(mocks.generateContent.mock.calls[0][0].contents).toBe('x'.repeat(adapter.MAX_PROMPT_LEN));
  });
  it('falls 3.6 to 2.5 and never reverses an explicit 2.5 choice', async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ text: 'secondary' });
    const adapter = load(); const fallback = await adapter.handler(event({ model: 'gemini-3.6-flash', prompt: 'hello' }));
    expect(json(fallback)).toMatchObject({ model_used: 'gemini-2.5-flash', fallback_used: true });
    adapter.resetAdapterState(); mocks.generateContent.mockReset().mockResolvedValue({ text: 'chosen' });
    const explicit = await adapter.handler(event({ model: 'gemini-2.5-flash', prompt: 'hello' }));
    expect(json(explicit)).toMatchObject({ model_used: 'gemini-2.5-flash', fallback_used: false });
    expect(mocks.generateContent.mock.calls).toHaveLength(1);
  });
  it.each([
    ['empty text', { text: '' }, { text: ' ' }],
    ['malformed response', {}, null],
  ])('returns truthful local fallback metadata when both models yield %s', async (_name, primaryResponse, secondaryResponse) => {
    mocks.generateContent.mockResolvedValueOnce(primaryResponse).mockResolvedValueOnce(secondaryResponse);
    const adapter = load();
    const response = await adapter.handler(event({ model: 'gemini-3.6-flash', prompt: 'hello' }));
    expect(json(response)).toEqual({ text: '', model_used: 'local-fallback', cost_estimate: 0, fallback_used: true });
    expect(mocks.generateContent.mock.calls.map(([request]) => request.model)).toEqual(['gemini-3.6-flash', 'gemini-2.5-flash']);
  });
  it('does not retry a failed explicit 2.5 attempt when maxRetries is zero', async () => {
    mocks.generateContent.mockRejectedValue(new Error('unavailable'));
    const adapter = load();
    const response = await adapter.handler(event({ model: 'gemini-2.5-flash', prompt: 'hello' }));
    expect(json(response)).toMatchObject({ model_used: 'local-fallback', fallback_used: true });
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });
  it('rejects the thirty-first request from one client without a generation call', async () => {
    process.env.ADAPTER_DAILY_BUDGET_USD = '1';
    const adapter = load();
    for (let count = 0; count < 30; count += 1) {
      expect((await adapter.handler(event({ prompt: 'hello' }))).statusCode).toBe(200);
    }
    expect(mocks.generateContent).toHaveBeenCalledTimes(30);
    const response = await adapter.handler(event({ prompt: 'hello' }));
    expect(response.statusCode).toBe(429);
    expect(json(response)).toEqual({ error: 'Rate limit exceeded' });
    expect(mocks.generateContent).toHaveBeenCalledTimes(30);
  });
  it('returns local fallback for all failures and applies bounded cost, budget, counters, circuit and generic errors', async () => {
    const adapter = load(); process.env.ADAPTER_DAILY_BUDGET_USD = '0.000001';
    const budget = await adapter.handler(event({ prompt: 'hello' }));
    expect(json(budget)).toMatchObject({ model_used: 'local-fallback', fallback_used: true });
    adapter.resetAdapterState(); delete process.env.ADAPTER_DAILY_BUDGET_USD; mocks.generateContent.mockRejectedValue(new Error('failure'));
    await adapter.handler(event({ prompt: 'hello' })); await adapter.handler(event({ prompt: 'hello' }));
    expect(adapter.getCircuitState()['gemini-3.6-flash'].openUntil).toBeGreaterThan(0);
    expect(adapter.classifyError({ status: 429 })).toBe('rate-limit');
    expect(adapter.getRequestCounters()['gemini-3.6-flash']).toBeGreaterThan(0);
  });
  it('rejects invalid requests without leaking errors', async () => {
    const adapter = load();
    expect((await adapter.handler(event({ model: 'unknown', prompt: 'x' }))).statusCode).toBe(400);
    expect((await adapter.handler(event({}))).statusCode).toBe(400);
    expect((await adapter.handler(event({}, { httpMethod: 'PATCH' }))).statusCode).toBe(405);
  });
});
