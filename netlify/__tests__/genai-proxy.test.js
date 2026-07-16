import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const genaiMock = vi.hoisted(() => ({
  GoogleGenAI: vi.fn(),
  generateContent: vi.fn(),
}));

const proxyPath = join(dirname(fileURLToPath(import.meta.url)), '../functions/genai-proxy.js');
const proxySource = readFileSync(proxyPath, 'utf8');

const originalEnv = {
  API_KEY: process.env.API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,
};

const loadHandler = () => {
  const module = { exports: {} };
  const context = vm.createContext({
    console,
    Date,
    Map,
    JSON,
    process,
    require: (id) => {
      if (id === '@google/genai') {
        return { GoogleGenAI: genaiMock.GoogleGenAI };
      }
      throw new Error(`Unexpected require: ${id}`);
    },
    exports: module.exports,
    module,
  });
  const script = new vm.Script(proxySource, { filename: proxyPath });
  script.runInContext(context);
  return module.exports.handler;
};

const createEvent = (overrides = {}) => ({
  httpMethod: 'POST',
  headers: {
    origin: 'https://game.example',
    'x-nf-client-connection-ip': '198.51.100.10',
  },
  body: JSON.stringify({ prompt: 'Say hello' }),
  ...overrides,
});

const parseBody = (response) => JSON.parse(response.body);

describe('genai-proxy request validation', () => {
  beforeEach(() => {
    process.env.API_KEY = 'test-api-key';
    delete process.env.GEMINI_API_KEY;
    delete process.env.ALLOWED_ORIGIN;

    genaiMock.generateContent.mockResolvedValue({ text: 'mocked response' });
    genaiMock.GoogleGenAI.mockImplementation(() => ({
      models: { generateContent: genaiMock.generateContent },
    }));
  });

  afterEach(() => {
    process.env.API_KEY = originalEnv.API_KEY;
    process.env.GEMINI_API_KEY = originalEnv.GEMINI_API_KEY;
    process.env.ALLOWED_ORIGIN = originalEnv.ALLOWED_ORIGIN;
    vi.clearAllMocks();
  });

  it('responds to OPTIONS preflight with CORS headers and no Gemini call', async () => {
    const handler = loadHandler();

    const response = await handler(createEvent({ httpMethod: 'OPTIONS', body: '' }));

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect(response.headers).toMatchObject({
      'Access-Control-Allow-Origin': 'https://game.example',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'X-Content-Type-Options': 'nosniff',
    });
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
  });

  it('rejects non-POST requests before calling Gemini', async () => {
    const handler = loadHandler();

    const response = await handler(createEvent({ httpMethod: 'GET', body: '' }));

    expect(response.statusCode).toBe(405);
    expect(parseBody(response)).toEqual({ error: 'Method not allowed' });
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
  });

  it('rejects requests with a missing prompt', async () => {
    const handler = loadHandler();

    const response = await handler(createEvent({ body: JSON.stringify({}) }));

    expect(response.statusCode).toBe(400);
    expect(parseBody(response)).toEqual({ error: 'Missing prompt' });
    expect(genaiMock.GoogleGenAI).not.toHaveBeenCalled();
  });

  it('falls back to the default model when the requested model is not whitelisted', async () => {
    const handler = loadHandler();

    const response = await handler(
      createEvent({
        body: JSON.stringify({
          prompt: 'Generate a speech',
          model: 'gemini-expensive-preview',
          responseMimeType: 'application/json',
          temperature: 7,
        }),
      })
    );

    expect(response.statusCode).toBe(200);
    expect(genaiMock.GoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
    expect(genaiMock.generateContent).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
      contents: 'Generate a speech',
      config: { responseMimeType: 'application/json', temperature: 2 },
    });
  });

  it('truncates overlong prompts before sending them to Gemini', async () => {
    const handler = loadHandler();
    const overlongPrompt = 'x'.repeat(8005);

    const response = await handler(createEvent({ body: JSON.stringify({ prompt: overlongPrompt }) }));

    expect(response.statusCode).toBe(200);
    const request = genaiMock.generateContent.mock.calls[0][0];
    expect(request.contents).toHaveLength(8000);
    expect(request.contents).toBe('x'.repeat(8000));
  });

  it('returns a safe generic error when Gemini throws', async () => {
    const handler = loadHandler();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    genaiMock.generateContent.mockRejectedValue(new Error('leaked-internal-secret'));

    const response = await handler(createEvent());

    expect(response.statusCode).toBe(500);
    expect(parseBody(response)).toEqual({ error: 'AI generation failed' });
    expect(response.body).not.toContain('leaked-internal-secret');
    consoleError.mockRestore();
  });
});
