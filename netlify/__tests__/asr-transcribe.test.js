import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const {
  handler, MODEL, ASR_ENDPOINT, ASR_TIMEOUT_MS, MAX_AUDIO_BYTES,
} = createRequire(import.meta.url)('../../netlify/functions/asr-transcribe.cjs');

const origin = 'https://werewolf-example.netlify.app';
const audioBytes = Buffer.from('RIFF....WAVEfmt ', 'latin1');
const dataUrl = `data:audio/wav;base64,${audioBytes.toString('base64')}`;
const payload = (overrides = {}) => ({ audio: dataUrl, lang: 'en-US', durationMs: 1234, ...overrides });
const event = (overrides = {}) => {
  const base = {
    httpMethod: 'POST',
    rawUrl: `${origin}/.netlify/functions/asr-transcribe`,
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(payload()),
  };
  return {
    ...base,
    ...overrides,
    headers: { ...base.headers, ...(overrides.headers || {}) },
  };
};
const withBody = value => event({ body: JSON.stringify(value) });
const ok = contents => new Response(JSON.stringify(contents), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
const transcript = text => ok({ choices: [{ message: { content: text } }] });
const codeOf = result => JSON.parse(result.body).code;

let fetchMock;

beforeEach(() => {
  vi.stubEnv('QWEN_API_KEY', 'test-placeholder-key');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('asr-transcribe request gates', () => {
  it('accepts only POST', async () => {
    const result = await handler(event({ httpMethod: 'GET' }));

    expect(result.statusCode).toBe(405);
    expect(JSON.parse(result.body)).toEqual({ code: 'METHOD_NOT_ALLOWED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires the Origin header to match the request origin', async () => {
    const mismatch = await handler(event({ headers: { origin: 'https://evil.example' } }));
    const missing = await handler(event({ headers: { origin: '' } }));

    expect(mismatch.statusCode).toBe(403);
    expect(codeOf(mismatch)).toBe('FORBIDDEN_ORIGIN');
    expect(missing.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 ASR_NOT_CONFIGURED when the server key is missing', async () => {
    vi.stubEnv('QWEN_API_KEY', '');

    const result = await handler(event());

    expect(result.statusCode).toBe(503);
    expect(codeOf(result)).toBe('ASR_NOT_CONFIGURED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-JSON content type', async () => {
    const result = await handler(event({ headers: { 'content-type': 'text/plain' } }));

    expect(result.statusCode).toBe(415);
    expect(codeOf(result)).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', event({ body: '{not json' })],
    ['missing fields', withBody({ audio: dataUrl, lang: 'en-US' })],
    ['extra identity fields', withBody({ ...payload(), seat: 2 })],
    ['unsupported language', withBody(payload({ lang: 'fr-FR' }))],
    ['zero duration', withBody(payload({ durationMs: 0 }))],
    ['duration over 60s', withBody(payload({ durationMs: 60_001 }))],
    ['non-numeric duration', withBody(payload({ durationMs: '1200' }))],
    ['invalid base64', withBody(payload({ audio: 'not base64!!' }))],
    ['empty audio', withBody(payload({ audio: '' }))],
  ])('returns 400 for %s', async (_label, request) => {
    const result = await handler(request);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).code).toMatch(/^INVALID_/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects audio above the 2 MB decoded limit', async () => {
    const oversized = Buffer.alloc(MAX_AUDIO_BYTES + 1).toString('base64');

    const result = await handler(withBody(payload({ audio: oversized })));

    expect(result.statusCode).toBe(400);
    expect(codeOf(result)).toBe('INVALID_AUDIO');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized request body before decoding', async () => {
    const result = await handler(event({
      body: JSON.stringify(payload({ audio: 'A'.repeat(3_200_000) })),
    }));

    expect(result.statusCode).toBe(400);
    expect(codeOf(result)).toBe('INVALID_AUDIO');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts raw base64 audio and wraps it as a WAV data URL', async () => {
    fetchMock.mockResolvedValueOnce(transcript('hello'));

    const result = await handler(withBody(payload({ audio: audioBytes.toString('base64') })));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content[0].input_audio.data)
      .toBe(`data:audio/wav;base64,${audioBytes.toString('base64')}`);
  });
});

describe('asr-transcribe provider contract', () => {
  it('forwards only the model, audio and language and returns the final text', async () => {
    fetchMock.mockResolvedValueOnce(transcript('  I trust Player 4.  '));

    const result = await handler(event());

    expect(result.statusCode).toBe(200);
    expect(result.headers['Content-Type']).toBe('application/json');
    expect(result.headers['Cache-Control']).toBe('no-store');
    expect(JSON.parse(result.body)).toEqual({
      text: 'I trust Player 4.',
      model: MODEL,
      durationMs: 1234,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ASR_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.headers).toEqual({
      Authorization: 'Bearer test-placeholder-key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init.body)).toEqual({
      model: MODEL,
      messages: [{
        role: 'user',
        content: [{ type: 'input_audio', input_audio: { data: dataUrl } }],
      }],
      asr_options: { language: 'en' },
    });
  });

  it('maps zh-CN to the Qwen language hint', async () => {
    fetchMock.mockResolvedValueOnce(transcript('你好'));

    const result = await handler(withBody(payload({ lang: 'zh-CN' })));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).text).toBe('你好');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).asr_options).toEqual({ language: 'zh' });
  });

  it('returns an empty string for silence rather than inventing text', async () => {
    fetchMock.mockResolvedValueOnce(transcript('   '));

    const result = await handler(event());

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ text: '' });
  });

  it.each([
    ['rate limited', new Response('{"error":"quota"}', { status: 429 })],
    ['server error', new Response('{"error":"boom"}', { status: 500 })],
    ['service unavailable', new Response('', { status: 503 })],
  ])('collapses %s into one 502 without leaking details', async (_label, response) => {
    fetchMock.mockResolvedValueOnce(response);

    const result = await handler(event());

    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body)).toEqual({ code: 'ASR_UNAVAILABLE' });
    expect(result.body).not.toContain('quota');
    expect(result.body).not.toContain('boom');
  });

  it('uses a 12s provider deadline and reports a timeout as 502', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));

    const result = await handler(event());

    expect(result.statusCode).toBe(502);
    expect(codeOf(result)).toBe('ASR_UNAVAILABLE');
    expect(timeout).toHaveBeenCalledWith(ASR_TIMEOUT_MS);
  });

  it('treats a network failure as 502', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await handler(event());

    expect(result.statusCode).toBe(502);
    expect(codeOf(result)).toBe('ASR_UNAVAILABLE');
  });

  it('treats an unreadable provider payload as 502', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not json', { status: 200 }));

    const result = await handler(event());

    expect(result.statusCode).toBe(502);
    expect(codeOf(result)).toBe('ASR_UNAVAILABLE');
  });
});

describe('asr-transcribe logging', () => {
  let warnings;

  beforeEach(() => {
    warnings = [];
    vi.spyOn(console, 'warn').mockImplementation((...args) => { warnings.push(args); });
  });

  it('logs only enum fields for failures, never audio, text or the key', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"quota"}', { status: 429 }));
    await handler(event());

    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    await handler(event({ body: JSON.stringify(payload({ audio: dataUrl, durationMs: 2000 })) }));

    const lines = warnings.map(args => JSON.parse(String(args[0])));
    expect(lines).toEqual([
      { event: 'asr_rate_limited', lang: 'en-US', durationMs: 1234, status: 429 },
      { event: 'asr_timeout', lang: 'en-US', durationMs: 2000 },
    ]);
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain(dataUrl);
    expect(logged).not.toContain(audioBytes.toString('base64'));
    expect(logged).not.toContain('test-placeholder-key');
    expect(logged).not.toContain('quota');
  });

  it('does not log on the success path', async () => {
    fetchMock.mockResolvedValueOnce(transcript('hello'));

    expect((await handler(event())).statusCode).toBe(200);
    expect(warnings).toEqual([]);
  });
});
