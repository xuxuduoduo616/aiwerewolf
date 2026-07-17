import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const genaiMock = vi.hoisted(() => ({
  GoogleGenAI: vi.fn(),
  generateContent: vi.fn(),
}));

const adapterPath = join(dirname(fileURLToPath(import.meta.url)), '../functions/model-adapter.cjs');
const adapterSource = readFileSync(adapterPath, 'utf8');

const originalEnv = {
  API_KEY: process.env.API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
  ADAPTER_DRY_RUN: process.env.ADAPTER_DRY_RUN,
};

const loadModule = () => {
  const module = { exports: {} };
  const context = vm.createContext({
    console,
    Date,
    Map,
    JSON,
    process,
    setTimeout,
    Promise,
    Infinity,
    Math,
    Number,
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

describe('model-adapter', () => {
  beforeEach(() => {
    process.env.API_KEY = 'test-api-key';
    delete process.env.GEMINI_API_KEY;
    delete process.env.ALLOWED_ORIGIN;
    delete process.env.ADAPTER_DRY_RUN;
    genaiMock.generateContent.mockResolvedValue({ text: 'live text' });
    genaiMock.GoogleGenAI.mockImplementation(() => ({
      models: { generateContent: genaiMock.generateContent },
    }));
  });

  afterEach(() => {
    process.env.API_KEY = originalEnv.API_KEY;
    process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    process.env.ALLOWED_ORIGIN = originalEnv.ALLOWED_ORIGIN;
    process.env.ADAPTER_DRY_RUN = originalEnv.ADAPTER_DRY_RUN;
    vi.clearAllMocks();
  });

  it('exposes a whitelist including a zero-cost local fallback', () => {
    const { MODEL_REGISTRY } = loadModule();
    expect(MODEL_REGISTRY['gemini-2.5-flash']).toBeDefined();
    expect(MODEL_REGISTRY['local-fallback'].costPer1kTokens).toBe(0);
  });

  it('rejects an unknown model with 400 and no live call', async () => {
    const { handler } = loadModule();
    const res = await handler(createEvent({ prompt: 'hi', model: 'super-expensive-gpt' }));
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).error).toBe('Model not in whitelist');
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
  });

  it('rejects a request whose estimated cost exceeds the ceiling', async () => {
    const { handler, MODEL_REGISTRY, COST_CEILING_PER_CALL } = loadModule();
    // Cost = (chars/4/1000) * costPer1k. Solve for prompt length that exceeds ceiling.
    const costPer1k = MODEL_REGISTRY['gemini-2.5-flash'].costPer1kTokens;
    const tokensNeeded = (COST_CEILING_PER_CALL / costPer1k) * 1000 + 1000;
    const chars = Math.ceil(tokensNeeded * 4);
    const res = await handler(createEvent({ prompt: 'x'.repeat(chars) }));
    expect(res.statusCode).toBe(402);
    expect(parseBody(res).error).toContain('ceiling');
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
  });

  it('returns a deterministic mock in dry-run mode without any live call', async () => {
    process.env.ADAPTER_DRY_RUN = 'true';
    const { handler } = loadModule();
    const res = await handler(createEvent({ prompt: 'hello' }));
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.text).toContain('dry-run');
    expect(body.model_used).toBe('gemini-2.5-flash');
    expect(body.fallback_used).toBe(false);
    expect(typeof body.cost_estimate).toBe('number');
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
  });

  it('rejects missing prompt', async () => {
    const { handler } = loadModule();
    const res = await handler(createEvent({}));
    expect(res.statusCode).toBe(400);
    expect(parseBody(res).error).toBe('Missing prompt');
  });
});
