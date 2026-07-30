import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const genaiMock = vi.hoisted(() => ({
  GoogleGenAI: vi.fn(),
  generateContent: vi.fn(),
}));

const adapterPath = join(dirname(fileURLToPath(import.meta.url)), '../functions/provider-adapter.cjs');
const adapterSource = readFileSync(adapterPath, 'utf8');

// Obviously-fake placeholder keys, planted in process.env only to prove
// request shaping and log redaction. They are never real credentials.
const FAKE_GEMINI_KEY = 'fake-gemini-key-for-tests-only';
const FAKE_AICODEMIRROR_KEY = 'fake-aicodemirror-key-for-tests-only';
const FAKE_DEEPSEEK_KEY = 'fake-deepseek-key-for-tests-only';
const FAKE_OPENAI_KEY = 'fake-openai-key-for-tests-only';

const originalEnv = {
  API_KEY: process.env.API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  AICODEMIRROR_API_KEY: process.env.AICODEMIRROR_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
  ADAPTER_DRY_RUN: process.env.ADAPTER_DRY_RUN,
  ADAPTER_DAILY_BUDGET_USD: process.env.ADAPTER_DAILY_BUDGET_USD,
};

// Captured log lines — the adapter must never log key material.
const logLines = [];
const captureConsole = {
  error: (...args) => logLines.push(args.map(String).join(' ')),
  warn: (...args) => logLines.push(args.map(String).join(' ')),
  log: (...args) => logLines.push(args.map(String).join(' ')),
};

const fetchMock = vi.fn();

const loadModule = () => {
  const module = { exports: {} };
  const context = vm.createContext({
    console: captureConsole,
    Date,
    Map,
    JSON,
    process,
    setTimeout,
    clearTimeout,
    Promise,
    Infinity,
    Math,
    Number,
    AbortController,
    fetch: fetchMock,
    require: (id) => {
      if (id === '@google/genai') {
        return { GoogleGenAI: genaiMock.GoogleGenAI };
      }
      throw new Error(`Unexpected require: ${id}`);
    },
    exports: module.exports,
    module,
  });
  const script = new vm.Script(adapterSource, { filename: adapterPath });
  script.runInContext(context);
  return module.exports;
};

const createEvent = (bodyObj, overrides = {}) => ({
  httpMethod: 'POST',
  headers: {
    origin: 'https://game.example',
    'x-nf-client-connection-ip': '198.51.100.10',
  },
  body: JSON.stringify(bodyObj),
  ...overrides,
});

const parseBody = (response) => JSON.parse(response.body);

const jsonResponse = (obj, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => obj,
});
const anthropicResponse = (text) => jsonResponse({ content: [{ type: 'text', text }] });
const openaiResponse = (text) => jsonResponse({ choices: [{ message: { role: 'assistant', content: text } }] });
const responsesResponse = (text) =>
  jsonResponse({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

const httpError = (status) => Object.assign(new Error(`http-${status}`), { status });

describe('provider-adapter', () => {
  beforeEach(() => {
    process.env.API_KEY = FAKE_GEMINI_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.AICODEMIRROR_API_KEY = FAKE_AICODEMIRROR_KEY;
    process.env.DEEPSEEK_API_KEY = FAKE_DEEPSEEK_KEY;
    process.env.OPENAI_API_KEY = FAKE_OPENAI_KEY;
    delete process.env.ALLOWED_ORIGIN;
    delete process.env.ADAPTER_DRY_RUN;
    delete process.env.ADAPTER_DAILY_BUDGET_USD;
    logLines.length = 0;
    fetchMock.mockReset();
    fetchMock.mockRejectedValue(new Error('unexpected fetch'));
    genaiMock.generateContent.mockReset();
    genaiMock.generateContent.mockResolvedValue({ text: 'gemini live text' });
    genaiMock.GoogleGenAI.mockReset();
    genaiMock.GoogleGenAI.mockImplementation(() => ({
      models: { generateContent: genaiMock.generateContent },
    }));
  });

  afterEach(() => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    vi.clearAllMocks();
  });

  it('registry has the existing routes plus both exact OpenAI Responses routes', () => {
    const { PROVIDER_REGISTRY, DEFAULT_CHAIN, OPENAI_MODEL_IDS } = loadModule();
    const required = [
      'gemini-2.5-flash',
      'aicodemirror-claude',
      'deepseek-anthropic',
      'gpt-5.5',
      'gpt-5.6-luna',
    ];
    for (const name of required) {
      const cfg = PROVIDER_REGISTRY[name];
      expect(cfg).toBeDefined();
      expect(['gemini', 'anthropic-messages', 'openai-chat', 'openai-responses']).toContain(cfg.protocol);
      expect(typeof cfg.authHeader).toBe('string');
      expect(Array.isArray(cfg.apiKeyEnv)).toBe(true);
      expect(cfg.apiKeyEnv.length).toBeGreaterThan(0);
      expect(typeof cfg.timeout).toBe('number');
      expect(typeof cfg.maxRetries).toBe('number');
      expect(
        typeof cfg.costPer1kTokens === 'number' ||
          (typeof cfg.inputCostPer1kTokens === 'number' && typeof cfg.outputCostPer1kTokens === 'number')
      ).toBe(true);
      expect(Array.isArray(cfg.capabilities)).toBe(true);
    }
    expect(PROVIDER_REGISTRY['aicodemirror-claude'].protocol).toBe('anthropic-messages');
    expect(PROVIDER_REGISTRY['deepseek-anthropic'].protocol).toBe('anthropic-messages');
    expect(PROVIDER_REGISTRY['local-fallback'].costPer1kTokens).toBe(0);
    expect(JSON.stringify(PROVIDER_REGISTRY)).not.toContain('vibecoder');
    expect(Array.from(OPENAI_MODEL_IDS)).toEqual(['gpt-5.5', 'gpt-5.6-luna']);
    expect(PROVIDER_REGISTRY['gpt-5.5']).toMatchObject({
      model: 'gpt-5.5',
      protocol: 'openai-responses',
      apiKeyEnv: ['OPENAI_API_KEY'],
      inputCostPer1kTokens: 0.005,
      outputCostPer1kTokens: 0.03,
      maxOutputTokens: 128,
      costCeilingPerCall: 0.015,
    });
    expect(PROVIDER_REGISTRY['gpt-5.6-luna']).toMatchObject({
      model: 'gpt-5.6-luna',
      protocol: 'openai-responses',
      apiKeyEnv: ['OPENAI_API_KEY'],
      inputCostPer1kTokens: 0.001,
      outputCostPer1kTokens: 0.006,
      maxOutputTokens: 128,
      costCeilingPerCall: 0.005,
    });
    expect(DEFAULT_CHAIN).not.toContain('gpt-5.5');
    expect(DEFAULT_CHAIN).not.toContain('gpt-5.6-luna');
  });

  it('rejects an unknown provider with 400 and no live call', async () => {
    const { handler } = loadModule();
    const res = await handler(createEvent({ prompt: 'hi', provider: 'super-expensive-gpt' }));
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).error).toBe('Provider not in registry');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
  });

  it('rejects missing prompt', async () => {
    const { handler } = loadModule();
    const res = await handler(createEvent({}));
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).error).toBe('Missing prompt');
  });

  it('skips every over-ceiling live provider and returns the local fallback without outbound calls', async () => {
    const { handler, PROVIDER_REGISTRY, COST_CEILING_PER_CALL, getRequestCounters } = loadModule();
    const costPer1k = PROVIDER_REGISTRY['gemini-2.5-flash'].costPer1kTokens;
    const tokensNeeded = (COST_CEILING_PER_CALL / costPer1k) * 1000 + 1000;
    const chars = Math.ceil(tokensNeeded * 4);
    const res = await handler(createEvent({ prompt: 'x'.repeat(chars) }));
    expect(res.statusCode).toBe(200);
    expect(parseBody(res)).toMatchObject({
      text: '',
      model_used: 'local-fallback',
      cost_estimate: 0,
      fallback_used: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
    expect(getRequestCounters()).toEqual({ 'local-fallback:local-fallback': 1 });
  });

  it('returns a deterministic mock in dry-run mode without any network activity', async () => {
    process.env.ADAPTER_DRY_RUN = 'true';
    const { handler } = loadModule();
    const res = await handler(createEvent({ prompt: 'hello' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.text).toContain('dry-run');
    expect(body.model_used).toBe('gemini-2.5-flash');
    expect(body.fallback_used).toBe(false);
    expect(typeof body.cost_estimate).toBe('number');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
  });

  it('gemini protocol: routes through the SDK and returns its text', async () => {
    const { handler } = loadModule();
    const res = await handler(createEvent({ prompt: 'hello' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.text).toBe('gemini live text');
    expect(body.model_used).toBe('gemini-2.5-flash');
    expect(body.fallback_used).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(genaiMock.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash', contents: 'hello' })
    );
  });

  it('anthropic-messages protocol: correct request shape and text extraction', async () => {
    fetchMock.mockResolvedValue(anthropicResponse('anthropic says hi'));
    const { handler } = loadModule();
    const res = await handler(createEvent({ prompt: 'hello', provider: 'aicodemirror-claude', temperature: 0.4 }));
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.text).toBe('anthropic says hi');
    expect(body.model_used).toBe('aicodemirror-claude');
    expect(body.fallback_used).toBe(false);
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.aicodemirror.com/api/claudecode/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe(FAKE_AICODEMIRROR_KEY);
    expect(init.headers['anthropic-version']).toBeDefined();
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe('claude-sonnet-4-6');
    expect(typeof sent.max_tokens).toBe('number');
    expect(sent.temperature).toBe(0.4);
    expect(sent.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('openai-chat protocol: correct request shape and text extraction', async () => {
    fetchMock.mockResolvedValue(openaiResponse('openai says hi'));
    const { handler } = loadModule();
    const res = await handler(createEvent({ prompt: 'hello', provider: 'deepseek-openai' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.text).toBe('openai says hi');
    expect(body.model_used).toBe('deepseek-openai');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe(`Bearer ${FAKE_DEEPSEEK_KEY}`);
    const sent = JSON.parse(init.body);
    expect(sent.model).toBe('deepseek-chat');
    expect(sent.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it.each(['gpt-5.5', 'gpt-5.6-luna'])(
    'openai-responses protocol: preserves exact route metadata for %s',
    async (model) => {
      fetchMock.mockResolvedValue(responsesResponse(`${model} says hi`));
      const { handler, PROVIDER_REGISTRY } = loadModule();
      const res = await handler(createEvent({ prompt: 'hello', provider: model, temperature: 1.9 }));
      expect(res.statusCode).toBe(200);
      const body = parseBody(res);
      expect(body.text).toBe(`${model} says hi`);
      expect(body.model_used).toBe(model);
      expect(body.fallback_used).toBe(false);
      expect(body.cost_estimate).toBeGreaterThan(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/responses');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe(`Bearer ${FAKE_OPENAI_KEY}`);
      const sent = JSON.parse(init.body);
      expect(sent).toEqual({
        model,
        input: 'hello',
        reasoning: { effort: 'low' },
        max_output_tokens: PROVIDER_REGISTRY[model].maxOutputTokens,
      });
      expect(sent).not.toHaveProperty('temperature');
    }
  );

  it('openai-responses accepts the top-level output_text representation', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ output_text: 'top-level text' }));
    const { handler } = loadModule();
    const body = parseBody(await handler(createEvent({ prompt: 'hello', provider: 'gpt-5.5' })));
    expect(body).toMatchObject({
      text: 'top-level text',
      model_used: 'gpt-5.5',
      fallback_used: false,
    });
  });

  it('missing OPENAI_API_KEY deterministically falls back without an OpenAI network call', async () => {
    delete process.env.OPENAI_API_KEY;
    const { handler } = loadModule();
    const body = parseBody(await handler(createEvent({ prompt: 'hello', provider: 'gpt-5.5' })));
    expect(body).toMatchObject({
      text: 'gemini live text',
      model_used: 'gemini-2.5-flash',
      fallback_used: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logLines.filter((line) => line.includes('gpt-5.5') && line.includes('(auth)'))).toHaveLength(1);
  });

  it.each([
    ['auth', jsonResponse({}, 401)],
    ['rate-limit', jsonResponse({}, 429)],
    ['server', jsonResponse({}, 503)],
  ])('OpenAI %s errors are classified, redacted, and fall back', async (kind, upstream) => {
    fetchMock.mockResolvedValue(upstream);
    const { handler } = loadModule();
    const body = parseBody(await handler(createEvent({ prompt: 'hello', provider: 'gpt-5.6-luna' })));
    expect(body).toMatchObject({ model_used: 'gemini-2.5-flash', fallback_used: true });
    expect(logLines.some((line) => line.includes(`(${kind})`))).toBe(true);
    expect(logLines.join('\n')).not.toContain(FAKE_OPENAI_KEY);
  });

  it('OpenAI timeout, malformed JSON, and empty output all fall back deterministically', async () => {
    for (const failure of [
      () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      () => Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }),
      () => Promise.resolve(responsesResponse('')),
    ]) {
      fetchMock.mockReset();
      fetchMock.mockImplementation(failure);
      const { handler } = loadModule();
      const body = parseBody(await handler(createEvent({ prompt: 'hello', provider: 'gpt-5.5' })));
      expect(body).toMatchObject({ model_used: 'gemini-2.5-flash', fallback_used: true });
    }
    expect(logLines.join('\n')).not.toContain(FAKE_OPENAI_KEY);
  });

  it('an over-ceiling OpenAI primary is skipped and an allowed Gemini fallback may succeed', async () => {
    const firstAdapter = loadModule();
    const overCost = await firstAdapter.handler(
      createEvent({ prompt: 'x'.repeat(20000), provider: 'gpt-5.5' })
    );
    expect(overCost.statusCode).toBe(200);
    expect(parseBody(overCost)).toMatchObject({
      model_used: 'gemini-2.5-flash',
      fallback_used: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(genaiMock.GoogleGenAI).toHaveBeenCalledTimes(1);
    expect(firstAdapter.getRequestCounters()['gpt-5.5:gpt-5.5']).toBeUndefined();
  });

  it('returns local fallback when no provider fits the remaining daily budget', async () => {
    process.env.ADAPTER_DAILY_BUDGET_USD = '0.0000001';
    const secondAdapter = loadModule();
    const overBudget = await secondAdapter.handler(
      createEvent({ prompt: 'hello', provider: 'gpt-5.6-luna' })
    );
    expect(overBudget.statusCode).toBe(200);
    expect(parseBody(overBudget)).toMatchObject({
      model_used: 'local-fallback',
      fallback_used: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
    expect(secondAdapter.getRequestCounters()).toEqual({ 'local-fallback:local-fallback': 1 });
  });

  it('skips an over-ceiling fallback without calling or charging it', async () => {
    const prompt = 'x'.repeat(8000); // ~2,000 tokens; AICodeMirror estimate is $0.006 > $0.005.
    genaiMock.generateContent.mockRejectedValue(new Error('gemini down'));
    fetchMock.mockImplementation(async (url) => {
      if (url === 'https://api.openai.com/v1/responses') return jsonResponse({}, 503);
      if (String(url).includes('aicodemirror')) throw new Error('over-ceiling fallback must be skipped');
      if (url === 'https://api.deepseek.com/anthropic/v1/messages') {
        return anthropicResponse('deepseek within ceiling');
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const adapter = loadModule();
    const before = adapter.getBudgetRemaining();
    const response = await adapter.handler(createEvent({ prompt, provider: 'gpt-5.6-luna' }));
    const body = parseBody(response);
    expect(body).toMatchObject({
      text: 'deepseek within ceiling',
      model_used: 'deepseek-anthropic',
      fallback_used: true,
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
      'https://api.aicodemirror.com/api/claudecode/v1/messages'
    );
    expect(adapter.getRequestCounters()['aicodemirror-claude:claude-sonnet-4-6']).toBeUndefined();
    expect(before - adapter.getBudgetRemaining()).toBeCloseTo(body.cost_estimate, 12);
    expect(logLines.some((line) => line.includes('aicodemirror-claude skipped: per-call cost ceiling'))).toBe(true);
  });

  it('skips a fallback that exceeds remaining budget without calling or charging it', async () => {
    const prompt = 'x'.repeat(1600); // ~400 tokens: Luna $0.001168, AICodeMirror $0.0012.
    process.env.ADAPTER_DAILY_BUDGET_USD = '0.00118';
    genaiMock.generateContent.mockRejectedValue(new Error('gemini down'));
    fetchMock.mockImplementation(async (url) => {
      if (url === 'https://api.openai.com/v1/responses') return jsonResponse({}, 503);
      if (String(url).includes('aicodemirror')) throw new Error('over-budget fallback must be skipped');
      if (url === 'https://api.deepseek.com/anthropic/v1/messages') {
        return anthropicResponse('deepseek within remaining budget');
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    const adapter = loadModule();
    const before = adapter.getBudgetRemaining();
    const response = await adapter.handler(createEvent({ prompt, provider: 'gpt-5.6-luna' }));
    const body = parseBody(response);
    expect(body).toMatchObject({
      text: 'deepseek within remaining budget',
      model_used: 'deepseek-anthropic',
      fallback_used: true,
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
      'https://api.aicodemirror.com/api/claudecode/v1/messages'
    );
    expect(adapter.getRequestCounters()['aicodemirror-claude:claude-sonnet-4-6']).toBeUndefined();
    expect(before - adapter.getBudgetRemaining()).toBeCloseTo(body.cost_estimate, 12);
    expect(logLines.some((line) => line.includes('aicodemirror-claude skipped: daily budget remaining'))).toBe(true);
  });

  it('GET capabilities is no-store and Gemini-only without an OpenAI key', async () => {
    delete process.env.OPENAI_API_KEY;
    const { handler } = loadModule();
    const res = await handler(createEvent({}, { httpMethod: 'GET', body: '' }));
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(parseBody(res)).toEqual({
      default_model: 'gemini-2.5-flash',
      models: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET capabilities exposes both GPT models atomically after exact metadata proof and caches success', async () => {
    fetchMock.mockImplementation(async (url) => {
      const model = decodeURIComponent(String(url).split('/').pop());
      return jsonResponse({ id: model });
    });
    const { handler } = loadModule();
    const first = await handler(createEvent({}, { httpMethod: 'GET', body: '' }));
    expect(parseBody(first).models.map(({ id }) => id)).toEqual([
      'gemini-2.5-flash',
      'gpt-5.5',
      'gpt-5.6-luna',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toMatch(/^https:\/\/api\.openai\.com\/v1\/models\/gpt-5\./);
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toBe(`Bearer ${FAKE_OPENAI_KEY}`);
      expect(init).not.toHaveProperty('body');
    }

    await handler(createEvent({}, { httpMethod: 'GET', body: '' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['mismatched id', (model) => jsonResponse({ id: model === 'gpt-5.5' ? model : 'different-model' })],
    ['auth failure', () => jsonResponse({}, 401)],
    ['timeout', () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))],
  ])('GET capabilities remains atomically Gemini-only on %s', async (_name, responseFor) => {
    fetchMock.mockImplementation(async (url) => {
      const model = decodeURIComponent(String(url).split('/').pop());
      return responseFor(model);
    });
    const { handler } = loadModule();
    const res = await handler(createEvent({}, { httpMethod: 'GET', body: '' }));
    expect(parseBody(res).models).toEqual([{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }]);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(logLines.join('\n')).not.toContain(FAKE_OPENAI_KEY);
  });

  it('classifies errors as auth, timeout, rate-limit, server, and network', () => {
    const { classifyError } = loadModule();
    expect(classifyError(httpError(401))).toBe('auth');
    expect(classifyError(httpError(403))).toBe('auth');
    expect(classifyError(new Error('missing-api-key'))).toBe('auth');
    expect(classifyError(httpError(429))).toBe('rate-limit');
    expect(classifyError(httpError(500))).toBe('server');
    expect(classifyError(httpError(503))).toBe('server');
    expect(classifyError(new Error('timeout'))).toBe('timeout');
    expect(classifyError(new Error('ECONNRESET'))).toBe('network');
  });

  it('circuit breaker opens after the threshold and recovers after cooldown', () => {
    const {
      recordProviderFailure,
      recordProviderSuccess,
      isProviderOpen,
      resetProviderState,
      BREAKER_THRESHOLD,
      BREAKER_COOLDOWN_MS,
    } = loadModule();
    resetProviderState();
    const t = 1_000_000;
    for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) {
      recordProviderFailure('deepseek-anthropic', t);
      expect(isProviderOpen('deepseek-anthropic', t + 1)).toBe(false);
    }
    recordProviderFailure('deepseek-anthropic', t);
    expect(isProviderOpen('deepseek-anthropic', t + 1)).toBe(true);
    expect(isProviderOpen('deepseek-anthropic', t + BREAKER_COOLDOWN_MS - 1)).toBe(true);
    // Cooldown expired: the provider is attempted again.
    expect(isProviderOpen('deepseek-anthropic', t + BREAKER_COOLDOWN_MS + 1)).toBe(false);
    // A success fully resets the breaker.
    recordProviderSuccess('deepseek-anthropic');
    recordProviderFailure('deepseek-anthropic', t + BREAKER_COOLDOWN_MS + 2);
    expect(isProviderOpen('deepseek-anthropic', t + BREAKER_COOLDOWN_MS + 3)).toBe(false);
  });

  it('handler skips a provider whose circuit is open', async () => {
    const adapter = loadModule();
    const { handler, recordProviderFailure, BREAKER_THRESHOLD } = adapter;
    for (let i = 0; i < BREAKER_THRESHOLD; i++) {
      recordProviderFailure('aicodemirror-claude', Date.now());
    }
    genaiMock.generateContent.mockRejectedValue(new Error('gemini down'));
    fetchMock.mockResolvedValue(anthropicResponse('deepseek rescue'));
    const res = await handler(createEvent({ prompt: 'hello', provider: 'aicodemirror-claude' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.text).toBe('deepseek rescue');
    expect(body.model_used).toBe('deepseek-anthropic');
    expect(body.fallback_used).toBe(true);
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls.some((url) => url.includes('aicodemirror'))).toBe(false);
  });

  it('a missing API key is an auth failure: no live call and no retries', async () => {
    delete process.env.AICODEMIRROR_API_KEY;
    genaiMock.generateContent.mockRejectedValue(new Error('gemini down'));
    fetchMock.mockResolvedValue(anthropicResponse('deepseek rescue'));
    const { handler } = loadModule();
    const res = await handler(createEvent({ prompt: 'hello', provider: 'aicodemirror-claude' }));
    expect(parseBody(res).model_used).toBe('deepseek-anthropic');
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls.some((url) => url.includes('aicodemirror'))).toBe(false);
    const authLines = logLines.filter((line) => line.includes('aicodemirror-claude') && line.includes('(auth)'));
    expect(authLines).toHaveLength(1);
  });

  it('fallback chain is deterministic and ends in the local-fallback signal', async () => {
    genaiMock.generateContent.mockRejectedValue(new Error('gemini down'));
    fetchMock.mockRejectedValue(new Error('provider down'));
    const { handler, PROVIDER_REGISTRY } = loadModule();
    const res = await handler(createEvent({ prompt: 'hello' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.text).toBe('');
    expect(body.model_used).toBe('local-fallback');
    expect(body.fallback_used).toBe(true);
    expect(body.cost_estimate).toBe(0);
    // Gemini exhausts SDK retries first, then each fetch provider in registry order.
    expect(genaiMock.generateContent).toHaveBeenCalledTimes(
      PROVIDER_REGISTRY['gemini-2.5-flash'].maxRetries + 1
    );
    const urls = fetchMock.mock.calls.map(([url]) => url);
    const acmAttempts = PROVIDER_REGISTRY['aicodemirror-claude'].maxRetries + 1;
    const dsaAttempts = PROVIDER_REGISTRY['deepseek-anthropic'].maxRetries + 1;
    const dsoAttempts = PROVIDER_REGISTRY['deepseek-openai'].maxRetries + 1;
    expect(urls).toEqual([
      ...Array(acmAttempts).fill('https://api.aicodemirror.com/api/claudecode/v1/messages'),
      ...Array(dsaAttempts).fill('https://api.deepseek.com/anthropic/v1/messages'),
      ...Array(dsoAttempts).fill('https://api.deepseek.com/v1/chat/completions'),
    ]);
  });

  it('never logs planted fake keys even when errors embed them', async () => {
    genaiMock.generateContent.mockRejectedValue(new Error(`invalid key ${FAKE_GEMINI_KEY}`));
    fetchMock.mockRejectedValue(
      new Error(
        `401 x-api-key: ${FAKE_AICODEMIRROR_KEY} Authorization: Bearer ${FAKE_DEEPSEEK_KEY} ${FAKE_OPENAI_KEY}`
      )
    );
    const { handler } = loadModule();
    await handler(createEvent({ prompt: 'hello' }));
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(line).not.toContain(FAKE_GEMINI_KEY);
      expect(line).not.toContain(FAKE_AICODEMIRROR_KEY);
      expect(line).not.toContain(FAKE_DEEPSEEK_KEY);
      expect(line).not.toContain(FAKE_OPENAI_KEY);
    }
    expect(logLines.some((line) => line.includes('[REDACTED]'))).toBe(true);
  });

  it('redactForLog strips raw header values and bearer tokens', () => {
    const { redactForLog } = loadModule();
    expect(redactForLog(`x-api-key: ${FAKE_AICODEMIRROR_KEY}`)).not.toContain(FAKE_AICODEMIRROR_KEY);
    expect(redactForLog('Authorization: Bearer some-opaque-token')).not.toContain('some-opaque-token');
    expect(redactForLog(new Error(`key=${FAKE_DEEPSEEK_KEY}`))).not.toContain(FAKE_DEEPSEEK_KEY);
    expect(redactForLog('plain message')).toBe('plain message');
  });

  it('daily budget defaults to $1 and is env-configurable, ignoring invalid values', () => {
    const adapter = loadModule();
    expect(adapter.DEFAULT_DAILY_BUDGET_USD).toBe(1.0);
    expect(adapter.getBudgetRemaining()).toBe(1.0);
    process.env.ADAPTER_DAILY_BUDGET_USD = '2.5';
    expect(adapter.getBudgetRemaining()).toBe(2.5);
    process.env.ADAPTER_DAILY_BUDGET_USD = 'not-a-number';
    expect(adapter.getBudgetRemaining()).toBe(1.0);
    process.env.ADAPTER_DAILY_BUDGET_USD = '0';
    expect(adapter.getBudgetRemaining()).toBe(1.0);
    process.env.ADAPTER_DAILY_BUDGET_USD = '-3';
    expect(adapter.getBudgetRemaining()).toBe(1.0);
  });

  it('successful responses include budget_remaining and accumulate spend', async () => {
    const { handler, DEFAULT_DAILY_BUDGET_USD } = loadModule();
    const first = parseBody(await handler(createEvent({ prompt: 'hello' })));
    expect(first.budget_remaining).toBeCloseTo(DEFAULT_DAILY_BUDGET_USD - first.cost_estimate, 12);
    // Pre-existing contract fields are unchanged.
    expect(first.text).toBe('gemini live text');
    expect(first.model_used).toBe('gemini-2.5-flash');
    expect(first.fallback_used).toBe(false);
    const second = parseBody(await handler(createEvent({ prompt: 'hello' })));
    expect(second.budget_remaining).toBeLessThan(first.budget_remaining);
  });

  it('returns the local-fallback signal without live attempts when the daily budget is exhausted', async () => {
    const { handler, recordBudgetSpend, DEFAULT_DAILY_BUDGET_USD } = loadModule();
    recordBudgetSpend(DEFAULT_DAILY_BUDGET_USD);
    const res = await handler(createEvent({ prompt: 'hello' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.text).toBe('');
    expect(body.fallback_used).toBe(true);
    expect(body.model_used).toBe('local-fallback');
    expect(body.budget_remaining).toBe(0);
    // Never makes a live provider call.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
  });

  it('budget accumulator resets on UTC day rollover but not within the same day', () => {
    const { getBudgetRemaining, recordBudgetSpend, DEFAULT_DAILY_BUDGET_USD } = loadModule();
    const t0 = Date.UTC(2026, 0, 1, 12, 0, 0);
    recordBudgetSpend(DEFAULT_DAILY_BUDGET_USD + 5, t0);
    expect(getBudgetRemaining(t0)).toBe(0);
    // Later the same UTC day: still exhausted.
    expect(getBudgetRemaining(t0 + 3 * 3600 * 1000)).toBe(0);
    // Next UTC day: accumulator resets to the full budget.
    expect(getBudgetRemaining(t0 + 24 * 3600 * 1000)).toBe(DEFAULT_DAILY_BUDGET_USD);
  });

  it('tracks per-provider/model request counters and resets via the test hook', async () => {
    const adapter = loadModule();
    const { handler, getRequestCounters, resetBudgetState, DEFAULT_DAILY_BUDGET_USD } = adapter;
    await handler(createEvent({ prompt: 'hello' }));
    expect(getRequestCounters()['gemini-2.5-flash:gemini-2.5-flash']).toBe(1);
    // A full chain failure counts every attempted provider plus local-fallback.
    genaiMock.generateContent.mockRejectedValue(new Error('gemini down'));
    fetchMock.mockRejectedValue(new Error('provider down'));
    await handler(createEvent({ prompt: 'hello' }));
    const counters = getRequestCounters();
    expect(counters['gemini-2.5-flash:gemini-2.5-flash']).toBe(2);
    expect(counters['aicodemirror-claude:claude-sonnet-4-6']).toBe(1);
    expect(counters['deepseek-anthropic:deepseek-chat']).toBe(1);
    expect(counters['deepseek-openai:deepseek-chat']).toBe(1);
    expect(counters['local-fallback:local-fallback']).toBe(1);
    resetBudgetState();
    expect(getRequestCounters()).toEqual({});
    expect(adapter.getBudgetRemaining()).toBe(DEFAULT_DAILY_BUDGET_USD);
  });

  it('dry-run responses include budget_remaining without spending budget', async () => {
    process.env.ADAPTER_DRY_RUN = 'true';
    const { handler, getBudgetRemaining, getRequestCounters, DEFAULT_DAILY_BUDGET_USD } = loadModule();
    const body = parseBody(await handler(createEvent({ prompt: 'hello' })));
    expect(body.text).toContain('dry-run');
    expect(body.budget_remaining).toBe(DEFAULT_DAILY_BUDGET_USD);
    // Dry-run never spends budget but does count the routed request.
    expect(getBudgetRemaining()).toBe(DEFAULT_DAILY_BUDGET_USD);
    expect(getRequestCounters()['gemini-2.5-flash:gemini-2.5-flash']).toBe(1);
  });

  it('all-providers-failed local fallback includes budget_remaining', async () => {
    genaiMock.generateContent.mockRejectedValue(new Error('gemini down'));
    fetchMock.mockRejectedValue(new Error('provider down'));
    const { handler, DEFAULT_DAILY_BUDGET_USD } = loadModule();
    const res = await handler(createEvent({ prompt: 'hello' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.text).toBe('');
    expect(body.fallback_used).toBe(true);
    // No successful live call, so nothing was spent.
    expect(body.budget_remaining).toBe(DEFAULT_DAILY_BUDGET_USD);
  });
});
