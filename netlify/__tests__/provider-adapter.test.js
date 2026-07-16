import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const genaiMock = vi.hoisted(() => ({
  GoogleGenAI: vi.fn(),
  generateContent: vi.fn(),
}));

const adapterPath = join(dirname(fileURLToPath(import.meta.url)), '../functions/provider-adapter.js');
const adapterSource = readFileSync(adapterPath, 'utf8');

// Obviously-fake placeholder keys, planted in process.env only to prove
// request shaping and log redaction. They are never real credentials.
const FAKE_GEMINI_KEY = 'fake-gemini-key-for-tests-only';
const FAKE_AICODEMIRROR_KEY = 'fake-aicodemirror-key-for-tests-only';
const FAKE_DEEPSEEK_KEY = 'fake-deepseek-key-for-tests-only';

const originalEnv = {
  API_KEY: process.env.API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  AICODEMIRROR_API_KEY: process.env.AICODEMIRROR_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
  ADAPTER_DRY_RUN: process.env.ADAPTER_DRY_RUN,
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

const httpError = (status) => Object.assign(new Error(`http-${status}`), { status });

describe('provider-adapter', () => {
  beforeEach(() => {
    process.env.API_KEY = FAKE_GEMINI_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.AICODEMIRROR_API_KEY = FAKE_AICODEMIRROR_KEY;
    process.env.DEEPSEEK_API_KEY = FAKE_DEEPSEEK_KEY;
    delete process.env.ALLOWED_ORIGIN;
    delete process.env.ADAPTER_DRY_RUN;
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

  it('registry has gemini, aicodemirror, and deepseek routes with full config and no vibecoder', () => {
    const { PROVIDER_REGISTRY } = loadModule();
    const required = ['gemini-2.5-flash', 'aicodemirror-claude', 'deepseek-anthropic'];
    for (const name of required) {
      const cfg = PROVIDER_REGISTRY[name];
      expect(cfg).toBeDefined();
      expect(['gemini', 'anthropic-messages', 'openai-chat']).toContain(cfg.protocol);
      expect(typeof cfg.authHeader).toBe('string');
      expect(Array.isArray(cfg.apiKeyEnv)).toBe(true);
      expect(cfg.apiKeyEnv.length).toBeGreaterThan(0);
      expect(typeof cfg.timeout).toBe('number');
      expect(typeof cfg.maxRetries).toBe('number');
      expect(typeof cfg.costPer1kTokens).toBe('number');
      expect(Array.isArray(cfg.capabilities)).toBe(true);
    }
    expect(PROVIDER_REGISTRY['aicodemirror-claude'].protocol).toBe('anthropic-messages');
    expect(PROVIDER_REGISTRY['deepseek-anthropic'].protocol).toBe('anthropic-messages');
    expect(PROVIDER_REGISTRY['local-fallback'].costPer1kTokens).toBe(0);
    expect(JSON.stringify(PROVIDER_REGISTRY)).not.toContain('vibecoder');
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

  it('rejects a request whose estimated cost exceeds the ceiling', async () => {
    const { handler, PROVIDER_REGISTRY, COST_CEILING_PER_CALL } = loadModule();
    const costPer1k = PROVIDER_REGISTRY['gemini-2.5-flash'].costPer1kTokens;
    const tokensNeeded = (COST_CEILING_PER_CALL / costPer1k) * 1000 + 1000;
    const chars = Math.ceil(tokensNeeded * 4);
    const res = await handler(createEvent({ prompt: 'x'.repeat(chars) }));
    expect(res.statusCode).toBe(402);
    expect(parseBody(res).error).toContain('ceiling');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
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
      new Error(`401 x-api-key: ${FAKE_AICODEMIRROR_KEY} Authorization: Bearer ${FAKE_DEEPSEEK_KEY}`)
    );
    const { handler } = loadModule();
    await handler(createEvent({ prompt: 'hello' }));
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(line).not.toContain(FAKE_GEMINI_KEY);
      expect(line).not.toContain(FAKE_AICODEMIRROR_KEY);
      expect(line).not.toContain(FAKE_DEEPSEEK_KEY);
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
});
