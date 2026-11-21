import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const mocks = vi.hoisted(() => ({
  GoogleGenAI: vi.fn(),
  get: vi.fn(),
  generateContent: vi.fn(),
  fetch: vi.fn(),
  console: { warn: vi.fn(), log: vi.fn(), error: vi.fn() },
}));
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../functions/provider-adapter.cjs'), 'utf8');
const original = { API_KEY: process.env.API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY, GOOGLE_GEMINI_BASE_URL: process.env.GOOGLE_GEMINI_BASE_URL, DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY, ARK_API_KEY: process.env.ARK_API_KEY, ARK_DOUBAO_MODEL: process.env.ARK_DOUBAO_MODEL, ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN, ADAPTER_DRY_RUN: process.env.ADAPTER_DRY_RUN, ADAPTER_DAILY_BUDGET_USD: process.env.ADAPTER_DAILY_BUDGET_USD };
const load = () => {
  const module = { exports: {} };
  const context = vm.createContext({
    Date, Map, JSON, process, Promise, Math, Number, Infinity, URL, Request, Response, Headers, Buffer, AbortController, fetch: mocks.fetch, setTimeout, clearTimeout, console: mocks.console,
    require: (id) => id === '@google/genai' ? { GoogleGenAI: mocks.GoogleGenAI, ThinkingLevel: { MINIMAL: 'MINIMAL', LOW: 'LOW' } } : (() => { throw new Error(`Unexpected require ${id}`); })(),
    module, exports: module.exports,
  });
  new vm.Script(source).runInContext(context);
  return module.exports;
};
const event = (body = {}, overrides = {}) => ({ httpMethod: 'POST', headers: { origin: 'https://game.example', 'x-nf-client-connection-ip': '198.51.100.11' }, body: JSON.stringify(body), ...overrides });
const json = (response) => JSON.parse(response.body);

describe('Gemini provider adapter', () => {
  beforeEach(() => {
    delete process.env.DEEPSEEK_API_KEY; delete process.env.ARK_API_KEY; delete process.env.GOOGLE_GEMINI_BASE_URL;
    process.env.API_KEY = 'test-key'; process.env.ALLOWED_ORIGIN = 'https://game.example'; delete process.env.GEMINI_API_KEY; delete process.env.ADAPTER_DRY_RUN; delete process.env.ADAPTER_DAILY_BUDGET_USD;
    mocks.get.mockReset().mockImplementation(({ model }) => Promise.resolve({ name: `models/${model}` }));
    mocks.generateContent.mockReset().mockResolvedValue({ text: 'model text' });
    mocks.GoogleGenAI.mockReset().mockImplementation(() => ({ models: { get: mocks.get, generateContent: mocks.generateContent } }));
  });
  afterEach(() => { for (const [key, value] of Object.entries(original)) value === undefined ? delete process.env[key] : process.env[key] = value; vi.clearAllMocks(); });

  it('whitelists the exact Gemini and DeepSeek model IDs plus local fallback', () => {
    const { MODEL_REGISTRY } = load();
    expect(Object.keys(MODEL_REGISTRY)).toEqual(['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-2.5-flash', 'deepseek-flash', 'deepseek-v4-pro', 'doubao-seed-1.6-flash', 'doubao-seed-character', 'doubao-seed-2.1-lite', 'local-fallback']);
    expect(MODEL_REGISTRY['gemini-3.6-flash'].maxRetries).toBe(0);
    expect(MODEL_REGISTRY['gemini-3.8-flash'].maxRetries).toBe(0);
    expect(MODEL_REGISTRY['gemini-2.5-flash'].maxRetries).toBe(0);
  });
  it.each([
    ['missing allowlist configuration', () => { delete process.env.ALLOWED_ORIGIN; }, 'https://game.example'],
    ['mismatched Origin', () => { process.env.ALLOWED_ORIGIN = 'https://trusted.example'; }, 'https://game.example'],
  ])('fails closed on %s before capability, model, counters, or billing work', async (_name, setup, origin) => {
    setup();
    const adapter = load();
    const response = await adapter.handleEvent(event({ prompt: 'hello' }, { headers: { origin } }));
    expect(response.statusCode).toBe(403);
    expect(json(response)).toEqual({ error: 'Forbidden' });
    expect(response.headers).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(adapter.getRequestCounters()).toEqual({});
  });
  it('allows an Origin-less same-origin GET only with exact Host and Fetch Metadata evidence', async () => {
    const adapter = load();
    const response = await adapter.handleEvent(event({}, {
      httpMethod: 'GET', body: '', headers: { host: 'game.example', 'sec-fetch-site': 'same-origin' },
    }));
    expect(response.statusCode).toBe(200);
    expect(response.headers['Access-Control-Allow-Origin']).toBe('https://game.example');
    expect(mocks.get).toHaveBeenCalledTimes(3);
  });
  it('rejects an Origin-less request without same-origin evidence before model work', async () => {
    const adapter = load();
    const response = await adapter.handleEvent(event({ prompt: 'hello' }, { headers: { host: 'game.example' } }));
    expect(response.statusCode).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(adapter.getRequestCounters()).toEqual({});
  });
  it('rejects an Origin-less cross-site request even when Host matches', async () => {
    const adapter = load();
    const response = await adapter.handleEvent(event({ prompt: 'hello' }, {
      headers: { host: 'game.example', 'sec-fetch-site': 'cross-site' },
    }));
    expect(response.statusCode).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(adapter.getRequestCounters()).toEqual({});
  });
  it('returns a no-store, exact successful capability catalog and warm-caches success', async () => {
    const adapter = load();
    const first = await adapter.handleEvent(event({}, { httpMethod: 'GET', body: '' }));
    const second = await adapter.handleEvent(event({}, { httpMethod: 'GET', body: '' }));
    expect(json(first)).toMatchObject({ default_model: 'gemini-3.6-flash', models: [{ id: 'gemini-3.6-flash' }, { id: 'gemini-3.8-flash' }, { id: 'gemini-2.5-flash' }] });
    expect(first.headers['Cache-Control']).toBe('no-store');
    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(json(second)).toEqual(json(first));
  });
  it('discovers Gemini 3.6 and 3.8 through Netlify AI Gateway providers catalog when GOOGLE_GEMINI_BASE_URL is injected', async () => {
    process.env.GEMINI_API_KEY = 'gateway-token';
    process.env.GOOGLE_GEMINI_BASE_URL = 'https://game.example/.netlify/ai/';
    mocks.fetch.mockReset().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ providers: { gemini: { models: ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-4-argon'] } } }),
    });
    const adapter = load();
    const response = await adapter.handleEvent(event({}, { httpMethod: 'GET', body: '' }));
    expect(json(response)).toEqual({
      default_model: 'gemini-3.6-flash',
      verified_models: ['gemini-3.6-flash', 'gemini-3.8-flash'],
      models: [
        { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      ],
    });
    expect(mocks.fetch).toHaveBeenCalledWith('https://api.netlify.com/api/v1/ai-gateway/providers', expect.objectContaining({ method: 'GET', redirect: 'error' }));
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it.each([
    ['missing key', () => { delete process.env.API_KEY; }],
    ['403', () => { mocks.get.mockRejectedValue(Object.assign(new Error('denied'), { status: 403 })); }],
    ['429', () => { mocks.get.mockRejectedValue(Object.assign(new Error('limited'), { status: 429 })); }],
    ['5xx', () => { mocks.get.mockRejectedValue(Object.assign(new Error('bad upstream'), { status: 503 })); }],
    ['malformed metadata', () => { mocks.get.mockResolvedValue({ name: 'models/not-the-requested-model' }); }],
  ])('fails closed to 2.5 on %s', async (_name, setup) => {
    setup(); const adapter = load(); const response = await adapter.handleEvent(event({}, { httpMethod: 'GET', body: '' }));
    expect(json(response)).toEqual({ default_model: 'gemini-2.5-flash', verified_models: [], models: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }] });
  });
  it('fails closed to 2.5 when read-only model lookup times out', async () => {
    vi.useFakeTimers();
    try {
      mocks.get.mockImplementation(() => new Promise(() => {}));
      const adapter = load();
      const pending = adapter.handleEvent(event({}, { httpMethod: 'GET', body: '' }));
      await vi.advanceTimersByTimeAsync(5000);
      expect(json(await pending).default_model).toBe('gemini-2.5-flash');
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    ['gemini-3.6-flash', 'MINIMAL', 256],
    ['gemini-3.8-flash', 'LOW', 1024],
  ])('uses %s bounded thinking (%s, maxOutputTokens=%i) without sampling parameters and reports direct metadata', async (model, level, maxOutputTokens) => {
    const adapter = load(); const response = await adapter.handleEvent(event({ model, prompt: 'hello' }));
    expect(json(response)).toMatchObject({ model_used: model, fallback_used: false, text: 'model text' });
    expect(mocks.generateContent).toHaveBeenCalledWith(expect.objectContaining({ model, config: expect.objectContaining({ thinkingConfig: { thinkingLevel: level }, maxOutputTokens }) }));
    expect(mocks.generateContent.mock.calls[0][0].config).not.toHaveProperty('temperature');
    expect(mocks.generateContent.mock.calls[0][0].config).not.toHaveProperty('topP');
    expect(mocks.generateContent.mock.calls[0][0].config).not.toHaveProperty('topK');
  });
  it('truncates input sent to the SDK at the exported prompt bound', async () => {
    const adapter = load();
    const rawPrompt = 'x'.repeat(adapter.MAX_PROMPT_LEN + 40);
    await adapter.handleEvent(event({ model: 'gemini-3.6-flash', prompt: rawPrompt }));
    expect(mocks.generateContent.mock.calls[0][0].contents).toBe('x'.repeat(adapter.MAX_PROMPT_LEN));
  });
  it.each(['gemini-3.6-flash', 'gemini-3.8-flash'])('falls %s to 2.5 and never reverses an explicit 2.5 choice', async primary => {
    mocks.generateContent.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ text: 'secondary' });
    const adapter = load(); const fallback = await adapter.handleEvent(event({ model: primary, prompt: 'hello' }));
    expect(json(fallback)).toMatchObject({ model_used: 'gemini-2.5-flash', fallback_used: true });
    adapter.resetAdapterState(); mocks.generateContent.mockReset().mockResolvedValue({ text: 'chosen' });
    const explicit = await adapter.handleEvent(event({ model: 'gemini-2.5-flash', prompt: 'hello' }));
    expect(json(explicit)).toMatchObject({ model_used: 'gemini-2.5-flash', fallback_used: false });
    expect(mocks.generateContent.mock.calls).toHaveLength(1);
  });
  it.each([
    ['empty text', { text: '' }, { text: ' ' }],
    ['malformed response', {}, null],
  ])('returns truthful local fallback metadata when both models yield %s', async (_name, primaryResponse, secondaryResponse) => {
    mocks.generateContent.mockResolvedValueOnce(primaryResponse).mockResolvedValueOnce(secondaryResponse);
    const adapter = load();
    const response = await adapter.handleEvent(event({ model: 'gemini-3.6-flash', prompt: 'hello' }));
    expect(json(response)).toEqual({ text: '', model_used: 'local-fallback', cost_estimate: 0, fallback_used: true });
    expect(mocks.generateContent.mock.calls.map(([request]) => request.model)).toEqual(['gemini-3.6-flash', 'gemini-2.5-flash']);
  });
  it('does not retry a failed explicit 2.5 attempt when maxRetries is zero', async () => {
    mocks.generateContent.mockRejectedValue(new Error('unavailable'));
    const adapter = load();
    const response = await adapter.handleEvent(event({ model: 'gemini-2.5-flash', prompt: 'hello' }));
    expect(json(response)).toMatchObject({ model_used: 'local-fallback', fallback_used: true });
    expect(mocks.generateContent).toHaveBeenCalledTimes(1);
  });
  it.each(['MAX_TOKENS', 'SAFETY', 'RECITATION', 'OTHER'])('rejects nonempty but incomplete %s output and uses the next model', async finishReason => {
    mocks.generateContent.mockResolvedValueOnce({ text: '{"messages":[{"message":"Our unfinished plan"}]}', candidates: [{ finishReason }] })
      .mockResolvedValueOnce({ text: '{"messages":[{"message":"A complete plan."}]}', candidates: [{ finishReason: 'STOP' }] });
    const adapter = load();
    const response = await adapter.handleEvent(event({ prompt: 'night chat', responseMimeType: 'application/json' }));
    expect(json(response)).toMatchObject({ model_used: 'gemini-2.5-flash', fallback_used: true });
    expect(json(response).text).toContain('A complete plan.');
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
    expect(mocks.generateContent.mock.calls[0][0].config.maxOutputTokens).toBe(256);
  });
  it('preserves the cost ceiling and daily budget when a night response is incomplete', async () => {
    process.env.ADAPTER_DAILY_BUDGET_USD = '0.000001';
    const adapter = load();
    await adapter.handleEvent(event({ prompt: 'night chat', maxOutputTokens: 100000 }));
    expect(mocks.generateContent).not.toHaveBeenCalled();
    delete process.env.ADAPTER_DAILY_BUDGET_USD;
    adapter.resetAdapterState();
    await adapter.handleEvent(event({ prompt: 'x'.repeat(100000), maxOutputTokens: 100000 }));
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
  it('rejects the thirty-first request from one client without a generation call', async () => {
    process.env.ADAPTER_DAILY_BUDGET_USD = '1';
    const adapter = load();
    for (let count = 0; count < 30; count += 1) {
      expect((await adapter.handleEvent(event({ prompt: 'hello' }))).statusCode).toBe(200);
    }
    expect(mocks.generateContent).toHaveBeenCalledTimes(30);
    const response = await adapter.handleEvent(event({ prompt: 'hello' }));
    expect(response.statusCode).toBe(429);
    expect(json(response)).toEqual({ error: 'Rate limit exceeded' });
    expect(mocks.generateContent).toHaveBeenCalledTimes(30);
  });
  it('returns local fallback for all failures and applies bounded cost, budget, counters, circuit and generic errors', async () => {
    const adapter = load(); process.env.ADAPTER_DAILY_BUDGET_USD = '0.000001';
    const budget = await adapter.handleEvent(event({ prompt: 'hello' }));
    expect(json(budget)).toMatchObject({ model_used: 'local-fallback', fallback_used: true });
    adapter.resetAdapterState(); delete process.env.ADAPTER_DAILY_BUDGET_USD; mocks.generateContent.mockRejectedValue(new Error('failure'));
    await adapter.handleEvent(event({ prompt: 'hello' })); await adapter.handleEvent(event({ prompt: 'hello' }));
    expect(adapter.getCircuitState()['gemini-3.6-flash'].openUntil).toBeGreaterThan(0);
    expect(adapter.classifyError({ status: 429 })).toBe('rate-limit');
    expect(adapter.getRequestCounters()['gemini-3.6-flash']).toBeGreaterThan(0);
  });
  it('logs one enum-only line per failed model and the local fallback', async () => {
    mocks.generateContent.mockRejectedValue(Object.assign(new Error('limited'), { status: 429 }));
    const adapter = load();
    const response = await adapter.handleEvent(event({ model: 'gemini-3.6-flash', prompt: 'SECRET PROMPT TEXT' }));
    expect(json(response)).toMatchObject({ model_used: 'local-fallback', fallback_used: true });
    const lines = mocks.console.warn.mock.calls.map(([line]) => JSON.parse(line));
    expect(lines).toEqual([
      { event: 'provider_rate_limited', model: 'gemini-3.6-flash', cause: 'rate-limit', fallback: true },
      { event: 'provider_rate_limited', model: 'gemini-2.5-flash', cause: 'rate-limit', fallback: true },
      { event: 'provider_fallback', model: 'local-fallback', cause: 'rate-limit', fallback: true },
    ]);
    expect(Object.keys(lines[0])).toEqual(['event', 'model', 'cause', 'fallback']);
    for (const [line] of mocks.console.warn.mock.calls) expect(line).not.toContain('SECRET PROMPT TEXT');
  });
  it('maps a primary timeout to provider_timeout before the secondary succeeds', async () => {
    mocks.generateContent.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ text: 'secondary' });
    const adapter = load();
    const response = await adapter.handleEvent(event({ model: 'gemini-3.6-flash', prompt: 'hello' }));
    expect(json(response)).toMatchObject({ model_used: 'gemini-2.5-flash', fallback_used: true });
    expect(mocks.console.warn.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
      { event: 'provider_timeout', model: 'gemini-3.6-flash', cause: 'timeout', fallback: true },
    ]);
  });
  it('rejects invalid requests without leaking errors', async () => {
    const adapter = load();
    expect((await adapter.handleEvent(event({ model: 'unknown', prompt: 'x' }))).statusCode).toBe(400);
    expect((await adapter.handleEvent(event({}))).statusCode).toBe(400);
    expect((await adapter.handleEvent(event({}, { httpMethod: 'PATCH' }))).statusCode).toBe(405);
  });

  it('exposes a v2 Request/Response entry point with the same behavior', async () => {
    const adapter = load();
    expect(adapter.handler).toBeUndefined();
    const post = await adapter.default(new Request('https://game.example/.netlify/functions/provider-adapter', {
      method: 'POST',
      headers: { Origin: 'https://game.example', 'Content-Type': 'application/json', 'x-nf-client-connection-ip': '198.51.100.12' },
      body: JSON.stringify({ model: 'gemini-2.5-flash', prompt: 'hello' }),
    }));
    expect(post.status).toBe(200);
    expect(post.headers.get('access-control-allow-origin')).toBe('https://game.example');
    expect(await post.json()).toMatchObject({ text: 'model text', model_used: 'gemini-2.5-flash' });

    const preflight = await adapter.default(new Request('https://game.example/.netlify/functions/provider-adapter', {
      method: 'OPTIONS', headers: { Origin: 'https://game.example' },
    }));
    expect(preflight.status).toBe(204);

    const forbidden = await adapter.default(new Request('https://game.example/.netlify/functions/provider-adapter', {
      method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}',
    }));
    expect(forbidden.status).toBe(403);
  });
});

const deepseekResponse = (overrides = {}) => ({
  choices: [{ finish_reason: 'stop', message: { content: '{"en":"Complete dialogue"}', reasoning_content: 'PRIVATE REASONING' } }],
  usage: { prompt_tokens: 100, completion_tokens: 200 },
  ...overrides,
});
const httpResponse = payload => ({ ok: true, status: 200, json: async () => payload });

describe('DeepSeek expression routing', () => {
  beforeEach(() => {
    process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    delete process.env.ARK_API_KEY;
    process.env.ALLOWED_ORIGIN = 'https://game.example';
    delete process.env.API_KEY; delete process.env.GEMINI_API_KEY;
    delete process.env.ADAPTER_DRY_RUN; delete process.env.ADAPTER_DAILY_BUDGET_USD;
    mocks.fetch.mockReset().mockResolvedValue(httpResponse(deepseekResponse()));
    mocks.generateContent.mockReset(); mocks.get.mockReset();
    mocks.console.warn.mockClear();
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(original)) value === undefined ? delete process.env[key] : process.env[key] = value;
    vi.useRealTimers();
  });
  it.each([
    ['easy', 'deepseek-flash', 'low', 2048],
    ['normal', 'deepseek-flash', 'high', 4096],
    ['hard', 'deepseek-v4-pro', 'max', 8192],
  ])('routes %s automatically with the actual reasoning parameter', async (difficulty, model, effort, maxTokens) => {
    const result = await load().handleEvent(event({ model: 'deepseek-auto', difficulty, prompt: 'Return JSON dialogue', responseMimeType: 'application/json', reasoning_effort: 'ultra', max_tokens: 999999 }));
    expect(result.statusCode).toBe(200);
    expect(json(result)).toMatchObject({ model_used: model, reasoning_effort: effort, fallback_used: false, text: '{"en":"Complete dialogue"}' });
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer test-deepseek-key');
    expect(options.redirect).toBe('error');
    expect(JSON.parse(options.body)).toMatchObject({ model, reasoning_effort: effort, thinking: { type: 'enabled' }, max_tokens: maxTokens, response_format: { type: 'json_object' } });
    expect(JSON.parse(options.body)).not.toHaveProperty('temperature');
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE REASONING|test-deepseek-key|reasoning_content/);
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['deepseek-flash', 'deepseek-v4-pro'])('keeps an explicit %s choice at Expert while using max effort', async model => {
    const result = await load().handleEvent(event({ model, difficulty: 'hard', prompt: 'hello' }));
    expect(json(result)).toMatchObject({ model_used: model, reasoning_effort: 'max' });
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).model).toBe(model);
  });
  it.each(['deepseek-flash', 'deepseek-v4-pro'].flatMap(model => [['easy', 'low'], ['normal', 'high'], ['hard', 'max']].map(([difficulty, effort]) => [model, difficulty, effort])))('preserves assigned %s at %s with %s effort for day and night JSON', async (model, difficulty, effort) => {
    for (const prompt of ['Return daytime JSON speech', 'Return night messages JSON']) {
      mocks.fetch.mockClear();
      const response = await load().handleEvent(event({ model, difficulty, prompt, responseMimeType: 'application/json' }));
      expect(json(response)).toMatchObject({ model_used: model, reasoning_effort: effort, fallback_used: false });
      expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({ model, reasoning_effort: effort });
      expect(mocks.fetch).toHaveBeenCalledTimes(1);
    }
  });
  it.each(['deepseek-flash', 'deepseek-v4-pro'])('exposes only verified partial model %s, leaving backup unverified', async id => {
    mocks.fetch.mockResolvedValue(httpResponse({ data: [{ id }, { id: 'future-unimplemented' }] }));
    const result = json(await load().handleEvent(event({}, { httpMethod: 'GET' })));
    expect(result.verified_models).toEqual([id]);
    expect(result.models.map(model => model.id)).toEqual([id, 'gemini-2.5-flash']);
    expect(result.default_model).toBe(id);
  });
  it('discovers both exact models without Gemini credentials or paid generation and caches the catalog', async () => {
    mocks.fetch.mockResolvedValue(httpResponse({ data: [{ id: 'deepseek-flash' }, { id: 'deepseek-v4-pro' }] }));
    const adapter = load();
    const first = await adapter.handleEvent(event({}, { httpMethod: 'GET' }));
    const second = await adapter.handleEvent(event({}, { httpMethod: 'GET' }));
    expect(json(first)).toEqual({ default_model: 'deepseek-auto', verified_models: ['deepseek-flash', 'deepseek-v4-pro'], models: [
      { id: 'deepseek-auto', label: 'Automatic · DeepSeek by difficulty' },
      { id: 'deepseek-flash', label: 'DeepSeek V4.1 Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ] });
    expect(json(second)).toEqual(json(first));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://api.deepseek.com/models');
    expect(mocks.fetch.mock.calls[0][1].method).toBe('GET');
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
  it.each([{}, { data: null }, { data: [{ id: 'deepseek-v4.1-flash' }] }])('does not expose malformed or guessed models from metadata %j', async payload => {
    mocks.fetch.mockResolvedValue(httpResponse(payload));
    const result = await load().handleEvent(event({}, { httpMethod: 'GET' }));
    expect(json(result).models.map(model => model.id)).toEqual(['gemini-2.5-flash']);
  });
  it.each([401, 403, 429, 503])('fails closed on HTTP %s without leaking response data or retrying', async status => {
    mocks.fetch.mockResolvedValue({ ok: false, status, json: async () => ({ error: 'PRIVATE PROVIDER ERROR' }) });
    const adapter = load();
    const discovery = await adapter.handleEvent(event({}, { httpMethod: 'GET' }));
    expect(json(discovery).models.map(model => model.id)).toEqual(['gemini-2.5-flash']);
    mocks.fetch.mockClear();
    const result = await adapter.handleEvent(event({ model: 'deepseek-auto', prompt: 'PRIVATE PROMPT' }));
    expect(json(result)).toEqual({ text: '', model_used: 'local-fallback', fallback_used: true, cost_estimate: 0 });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.console.warn.mock.calls)).not.toMatch(/PRIVATE|test-deepseek-key/);
  });
  it('requires a DeepSeek key even when the Gemini key exists', async () => {
    delete process.env.DEEPSEEK_API_KEY; process.env.API_KEY = 'test-gemini';
    const result = await load().handleEvent(event({ model: 'deepseek-auto', prompt: 'hello' }));
    expect(json(result).model_used).toBe('local-fallback');
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
  it('validates origin, model and difficulty before any DeepSeek work', async () => {
    const adapter = load();
    expect((await adapter.handleEvent(event({ model: 'deepseek-auto', prompt: 'hello' }, { headers: { origin: 'https://evil.example' } }))).statusCode).toBe(403);
    for (const difficulty of ['max', '__proto__', null, {}, []]) {
      expect((await adapter.handleEvent(event({ model: 'deepseek-auto', difficulty, prompt: 'hello' }))).statusCode).toBe(400);
    }
    expect((await adapter.handleEvent(event({ model: 'deepseek-v4.1-flash', prompt: 'hello' }))).statusCode).toBe(400);
    expect((await adapter.handleEvent(event({}, { body: 'null' }))).statusCode).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each([
    { choices: [{ finish_reason: 'length', message: { content: '{"en":"partial"}' } }] },
    { choices: [{ finish_reason: 'content_filter', message: { content: '{}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: 'PRIVATE REASONING' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'broken json' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'null' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '[]' } }] },
  ])('rejects incomplete, empty and invalid JSON outputs', async payload => {
    mocks.fetch.mockResolvedValue(httpResponse(payload));
    const result = await load().handleEvent(event({ model: 'deepseek-auto', prompt: 'hello', responseMimeType: 'application/json' }));
    expect(json(result).model_used).toBe('local-fallback');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('aborts a hung generation after 45 seconds and returns local fallback', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(() => new Promise(() => {}));
    const pending = load().handleEvent(event({ model: 'deepseek-auto', prompt: 'hello' }));
    const signal = mocks.fetch.mock.calls[0][1].signal;
    await vi.advanceTimersByTimeAsync(45000);
    expect(json(await pending).model_used).toBe('local-fallback');
    expect(signal.aborted).toBe(true);
    expect(mocks.console.warn.mock.calls.map(([line]) => JSON.parse(line).cause)).toContain('timeout');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds read-only discovery to 5 seconds', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(() => new Promise(() => {}));
    const pending = load().handleEvent(event({}, { httpMethod: 'GET' }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(json(await pending).default_model).toBe('gemini-2.5-flash');
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it('retains budget and circuit guards, including full reasoning and UTF-8 input', async () => {
    const adapter = load();
    process.env.ADAPTER_DAILY_BUDGET_USD = '0.000001';
    await adapter.handleEvent(event({ model: 'deepseek-auto', difficulty: 'hard', prompt: 'hello' }));
    expect(mocks.fetch).not.toHaveBeenCalled();
    delete process.env.ADAPTER_DAILY_BUDGET_USD;
    adapter.resetAdapterState();
    await adapter.handleEvent(event({ model: 'deepseek-auto', difficulty: 'hard', prompt: '汉'.repeat(6000) }));
    expect(mocks.fetch).not.toHaveBeenCalled(); // conservative input + 8192 output exceeds $0.05
    process.env.ADAPTER_DAILY_BUDGET_USD = '1';
    mocks.fetch.mockRejectedValue(new Error('offline'));
    await adapter.handleEvent(event({ model: 'deepseek-flash', prompt: 'hello' }));
    await adapter.handleEvent(event({ model: 'deepseek-flash', prompt: 'hello' }));
    await adapter.handleEvent(event({ model: 'deepseek-flash', prompt: 'hello' }));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(adapter.getCircuitState()['deepseek-flash'].openUntil).toBeGreaterThan(0);
  });
  it('reserves concurrent worst-case costs and settles validated usage', async () => {
    const adapter = load();
    let release;
    mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = adapter.handleEvent(event({ model: 'deepseek-v4-pro', difficulty: 'hard', prompt: 'hello' }));
    const second = await adapter.handleEvent(event({ model: 'deepseek-v4-pro', difficulty: 'hard', prompt: 'hello' }));
    expect(json(second).model_used).toBe('local-fallback');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    release(httpResponse(deepseekResponse()));
    expect(json(await first).cost_estimate).toBeCloseTo(0.000924);
    mocks.fetch.mockResolvedValue(httpResponse(deepseekResponse()));
    const next = await adapter.handleEvent(event({ model: 'deepseek-v4-pro', difficulty: 'hard', prompt: 'hello' }));
    expect(json(next).model_used).toBe('deepseek-v4-pro');
  });
  it.each([undefined, { prompt_tokens: -1, completion_tokens: 1 }, { prompt_tokens: 100, completion_tokens: 999999 }])('keeps the reservation for missing or invalid usage %j', async usage => {
    mocks.fetch.mockResolvedValue(httpResponse(deepseekResponse({ usage })));
    const adapter = load();
    const first = await adapter.handleEvent(event({ model: 'deepseek-v4-pro', difficulty: 'hard', prompt: 'hello' }));
    expect(json(first).cost_estimate).toBeGreaterThan(0.032);
    const second = await adapter.handleEvent(event({ model: 'deepseek-v4-pro', difficulty: 'hard', prompt: 'hello' }));
    expect(json(second).model_used).toBe('local-fallback');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not refund a previous-day request into the next day’s active reservation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T23:59:59Z'));
    const releases = [];
    mocks.fetch.mockImplementation(() => new Promise(resolve => { releases.push(resolve); }));
    const adapter = load();
    const request = () => adapter.handleEvent(event({ model: 'deepseek-v4-pro', difficulty: 'hard', prompt: 'hello' }));
    const previousDay = request();
    vi.setSystemTime(new Date('2026-11-19T00:00:01Z'));
    const currentDay = request();
    releases[0](httpResponse(deepseekResponse()));
    expect(json(await previousDay).model_used).toBe('deepseek-v4-pro');
    expect(json(await request()).model_used).toBe('local-fallback');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    releases[1](httpResponse(deepseekResponse()));
    expect(json(await currentDay).model_used).toBe('deepseek-v4-pro');
  });
});

const arkResponse = (overrides = {}) => ({
  choices: [{ finish_reason: 'stop', message: { content: '{"en":"Doubao dialogue"}' } }],
  usage: { prompt_tokens: 120, completion_tokens: 90 },
  ...overrides,
});

describe('Doubao expression routing through Volcano Ark', () => {
  beforeEach(() => {
    process.env.ARK_API_KEY = 'test-ark-key';
    process.env.ALLOWED_ORIGIN = 'https://game.example';
    delete process.env.DEEPSEEK_API_KEY; delete process.env.API_KEY; delete process.env.GEMINI_API_KEY;
    delete process.env.ADAPTER_DRY_RUN; delete process.env.ADAPTER_DAILY_BUDGET_USD; delete process.env.ARK_DOUBAO_MODEL;
    mocks.fetch.mockReset().mockResolvedValue(httpResponse(arkResponse()));
    mocks.get.mockReset(); mocks.generateContent.mockReset();
    mocks.console.warn.mockClear();
  });
  afterEach(() => {
    for (const [key, value] of Object.entries(original)) value === undefined ? delete process.env[key] : process.env[key] = value;
    vi.useRealTimers();
  });
  it('calls Ark with the versioned model, no paid reasoning and the JSON contract', async () => {
    const result = await load().handleEvent(event({ model: 'doubao-seed-1.6-flash', prompt: 'Return JSON dialogue', responseMimeType: 'application/json', difficulty: 'normal' }));
    expect(result.statusCode).toBe(200);
    expect(json(result)).toMatchObject({ model_used: 'doubao-seed-1.6-flash', fallback_used: false, text: '{"en":"Doubao dialogue"}' });
    expect(json(result).cost_estimate).toBeCloseTo(0.0000215, 6);
    const [url, options] = mocks.fetch.mock.calls[0];
    expect(url).toBe('https://ark.cn-beijing.volces.com/api/v3/chat/completions');
    expect(options.headers.Authorization).toBe('Bearer test-ark-key');
    expect(options.redirect).toBe('error');
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ model: 'doubao-seed-1-6-flash-250615', max_tokens: 512, thinking: { type: 'disabled' }, response_format: { type: 'json_object' } });
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  const newRoutes = [
    ['doubao-seed-character', 'doubao-seed-character-260628', undefined, 0.000281690],
    ['doubao-seed-2.1-lite', 'doubao-seed-2-1-lite-260915', { type: 'disabled' }, 0.000380282],
  ];

  it.each(newRoutes)('routes and settles usage for %s independently of the Flash override', async (model, upstream, thinking, outputCost) => {
    process.env.ARK_DOUBAO_MODEL = 'doubao-seed-1-6-flash-251115';
    const adapter = load();
    const result = json(await adapter.handleEvent(event({ model, prompt: 'hello', responseMimeType: 'application/json' })));
    expect(result).toMatchObject({ model_used: model, fallback_used: false });
    expect(result.cost_estimate).toBeCloseTo((120 * 0.000112676 + 90 * outputCost) / 1000, 9);
    const body = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: upstream, max_tokens: 512, response_format: { type: 'json_object' } });
    if (thinking) expect(body.thinking).toEqual(thinking);
    else expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(adapter.getRequestCounters()).toMatchObject({ [model]: 1 });
  });

  it.each(newRoutes)('retries %s once on HTTP 400 and isolates its circuit', async (model, upstream, thinking) => {
    const adapter = load();
    mocks.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });
    const request = event({ model, prompt: 'hello', responseMimeType: 'application/json' });
    for (let attempt = 0; attempt < 3; attempt++) {
      expect(json(await adapter.handleEvent(request)).model_used).toBe('local-fallback');
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(4);
    const retry = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(retry).toMatchObject({ model: upstream, max_tokens: 512 });
    expect(retry).not.toHaveProperty('response_format');
    if (thinking) expect(retry.thinking).toEqual(thinking);
    else expect(retry).not.toHaveProperty('thinking');
    mocks.fetch.mockResolvedValue(httpResponse(arkResponse()));
    const other = newRoutes.find(([id]) => id !== model)[0];
    expect(json(await adapter.handleEvent(event({ model: other, prompt: 'hello' }))).model_used).toBe(other);
  });

  it.each([
    ['{"en":"Usable dialogue"}', 'doubao-seed-character'],
    ['Plain dialogue', 'local-fallback'],
  ])('keeps the JSON contract after Character retries with %s', async (content, expected) => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) })
      .mockResolvedValueOnce(httpResponse(arkResponse({
        choices: [{ finish_reason: 'stop', message: { content } }],
      })));
    const request = event({ model: 'doubao-seed-character', prompt: 'hello', responseMimeType: 'application/json' });
    expect(json(await load().handleEvent(request)).model_used).toBe(expected);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('exposes only the listed subset, with catalog labels', async () => {
    mocks.fetch.mockResolvedValue(httpResponse({ data: [
      { id: 'doubao-seed-character-260628' },
      { id: 'doubao-seed-2-1-lite-260914' },
    ] }));
    const adapter = load();
    const request = event({}, { httpMethod: 'GET' });
    const result = json(await adapter.handleEvent(request));
    expect(result.verified_models).toEqual(['doubao-seed-character']);
    expect(result.models.slice(1)).toEqual([{ id: 'doubao-seed-character', label: 'Doubao Seed Character' }]);
    expect(json(await adapter.handleEvent(request))).toEqual(result);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('honours an ARK_DOUBAO_MODEL override without changing the client id', async () => {
    process.env.ARK_DOUBAO_MODEL = 'doubao-seed-1-6-flash-251115';
    const result = await load().handleEvent(event({ model: 'doubao-seed-1.6-flash', prompt: 'hello' }));
    expect(json(result).model_used).toBe('doubao-seed-1.6-flash');
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).model).toBe('doubao-seed-1-6-flash-251115');
  });
  it('retries once with the minimal body when Ark rejects an optional parameter', async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'unsupported parameter' }) })
      .mockResolvedValueOnce(httpResponse(arkResponse()));
    const result = await load().handleEvent(event({ model: 'doubao-seed-1.6-flash', prompt: 'hello', responseMimeType: 'application/json' }));
    expect(json(result).model_used).toBe('doubao-seed-1.6-flash');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const retry = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(retry).toMatchObject({ model: 'doubao-seed-1-6-flash-250615', max_tokens: 512 });
    expect(retry).not.toHaveProperty('thinking');
    expect(retry).not.toHaveProperty('response_format');
  });
  it('falls back to local dialogue when Ark rejects both attempts', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: 'PRIVATE PROVIDER ERROR' }) });
    const result = await load().handleEvent(event({ model: 'doubao-seed-1.6-flash', prompt: 'PRIVATE PROMPT' }));
    expect(json(result)).toEqual({ text: '', model_used: 'local-fallback', fallback_used: true, cost_estimate: 0 });
    expect(JSON.stringify(mocks.console.warn.mock.calls)).not.toMatch(/PRIVATE|test-ark-key/);
  });
  it.each([
    { choices: [{ finish_reason: 'length', message: { content: '{"en":"partial"}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: 'broken json' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '[]' } }] },
  ])('rejects incomplete and non-object JSON output %#', async payload => {
    mocks.fetch.mockResolvedValue(httpResponse(payload));
    const result = await load().handleEvent(event({ model: 'doubao-seed-1.6-flash', prompt: 'hello', responseMimeType: 'application/json' }));
    expect(json(result).model_used).toBe('local-fallback');
  });
  it('accepts a fenced JSON reply', async () => {
    mocks.fetch.mockResolvedValue(httpResponse(arkResponse({
      choices: [{ finish_reason: 'stop', message: { content: '```json\n{"en":"Fenced dialogue"}\n```' } }],
    })));
    const result = await load().handleEvent(event({ model: 'doubao-seed-1.6-flash', prompt: 'hello', responseMimeType: 'application/json' }));
    expect(json(result)).toMatchObject({ model_used: 'doubao-seed-1.6-flash', text: '```json\n{"en":"Fenced dialogue"}\n```' });
  });
  it.each(['doubao-seed-1.6-flash', ...newRoutes.map(([id]) => id)])('requires an Ark key even when Gemini and DeepSeek keys exist (%s)', async model => {
    delete process.env.ARK_API_KEY;
    process.env.API_KEY = 'test-gemini'; process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';
    const result = await load().handleEvent(event({ model, prompt: 'hello' }));
    expect(json(result).model_used).toBe('local-fallback');
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
  it('exposes Doubao only when the Models API lists the configured version', async () => {
    mocks.fetch.mockResolvedValue(httpResponse({ data: [{ id: 'doubao-seed-1-6-flash-250615' }, { id: 'future-unimplemented' }] }));
    const adapter = load();
    const result = json(await adapter.handleEvent(event({}, { httpMethod: 'GET' })));
    expect(mocks.fetch.mock.calls[0][0]).toBe('https://ark.cn-beijing.volces.com/api/v3/models');
    expect(result.default_model).toBe('gemini-2.5-flash');
    expect(result.models.map(model => model.id)).toEqual(['gemini-2.5-flash', 'doubao-seed-1.6-flash']);
    expect(result.verified_models).toEqual(['doubao-seed-1.6-flash']);
  });
  it('does not expose a version the account cannot call', async () => {
    process.env.ARK_DOUBAO_MODEL = 'doubao-seed-1-7-flash-259999';
    mocks.fetch.mockResolvedValue(httpResponse({ data: [{ id: 'doubao-seed-1-6-flash-250615' }] }));
    const result = json(await load().handleEvent(event({}, { httpMethod: 'GET' })));
    expect(result.models.map(model => model.id)).toEqual(['gemini-2.5-flash']);
    expect(result.verified_models).toEqual([]);
  });
  it('keeps the client id whitelisted and rejects unknown Doubao ids', async () => {
    const adapter = load();
    expect((await adapter.handleEvent(event({ model: 'doubao-seed-1.6-pro', prompt: 'hello' }))).statusCode).toBe(400);
    expect((await adapter.handleEvent(event({ model: 'doubao-seed-1.6-flash', prompt: 'hello' }, { headers: { origin: 'https://evil.example' } }))).statusCode).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each(['doubao-seed-1.6-flash', ...newRoutes.map(([id]) => id)])('aborts a hung Ark call at 20 seconds and returns local dialogue (%s)', async model => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(() => new Promise(() => {}));
    const pending = load().handleEvent(event({ model, prompt: 'hello' }));
    const signal = mocks.fetch.mock.calls[0][1].signal;
    await vi.advanceTimersByTimeAsync(20000);
    expect(json(await pending).model_used).toBe('local-fallback');
    expect(signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
