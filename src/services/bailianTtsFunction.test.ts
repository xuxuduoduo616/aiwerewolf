import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const { handler } = createRequire(import.meta.url)('../../netlify/functions/bailian-tts.cjs');
const origin = 'https://deploy-preview-123--werewolf-example.netlify.app';
const tester = '39fae582-93ac-42b3-813b-6abb49b6e09b';
const jwt = 'test-placeholder-auth-token';
const text = '  You said you did not suspect Seven. Why did you vote for him?  ';
const event = {
  httpMethod: 'POST',
  rawUrl: origin + '/.netlify/functions/bailian-tts',
  headers: { origin, authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ text, lang: 'en-US', seat: 2 }),
};
const objectUrl = 'http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/sample.wav?Signature=test';
const pcmWave = (streamed = false) => {
  const wave = Buffer.alloc(48);
  wave.write('RIFF');
  wave.writeUInt32LE(streamed ? 0x7fffffbf : wave.length - 8, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(24000, 24);
  wave.writeUInt32LE(48000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(streamed ? 0x7fffff9b : wave.length - 44, 40);
  return wave;
};
const wave = pcmWave();
const auth = (id = tester) => Response.json({ id, aud: 'authenticated', role: 'authenticated' });
const output = (url = objectUrl) => Response.json({ output: { audio: { url } } });
let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv('BAILIAN_TTS_ENABLED', 'true');
  vi.stubEnv('BAILIAN_TTS_PRODUCTION_PILOT', '');
  vi.stubEnv('DASHSCOPE_API_KEY', 'test-placeholder-key');
  vi.stubEnv('BAILIAN_TTS_TESTER_ID', tester);
  vi.stubEnv('BAILIAN_TTS_PREVIEW_ORIGIN', origin);
  vi.stubEnv('BAILIAN_TTS_API_HOST', 'ws-example.cn-beijing.maas.aliyuncs.com');
  vi.stubEnv('SITE_NAME', 'werewolf-example');
  vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-placeholder-public-key');
  upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Bailian voice pilot', () => {
  it('blocks production, missing authorization, and overlong text before network work', async () => {
    const production = 'https://ai-werewolf.net';
    vi.stubEnv('BAILIAN_TTS_PREVIEW_ORIGIN', production);
    const productionEvent = { ...event, rawUrl: production, headers: { ...event.headers, origin: production } };
    expect((await handler(productionEvent)).statusCode).toBe(503);
    vi.stubEnv('BAILIAN_TTS_PREVIEW_ORIGIN', origin);
    expect((await handler({ ...event, headers: { origin } })).statusCode).toBe(401);
    expect((await handler({ ...event, body: JSON.stringify({ text: 'x'.repeat(601), lang: 'en-US', seat: 2 }) })).statusCode).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('allows the production pilot only for the configured tester', async () => {
    const production = 'https://ai-werewolf.net';
    vi.stubEnv('BAILIAN_TTS_PREVIEW_ORIGIN', production);
    vi.stubEnv('BAILIAN_TTS_PRODUCTION_PILOT', 'true');
    const productionEvent = { ...event, rawUrl: production, headers: { ...event.headers, origin: production } };
    upstream.mockResolvedValueOnce(auth('9577d5e9-75c4-4839-aaea-56c4890d632f'));
    expect((await handler(productionEvent)).statusCode).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(1);
    upstream.mockResolvedValueOnce(auth()).mockResolvedValueOnce(output())
      .mockResolvedValueOnce(new Response(wave));
    expect((await handler(productionEvent)).statusCode).toBe(200);
  });

  it('checks trusted identity before using the paid endpoint', async () => {
    upstream.mockResolvedValueOnce(auth('9577d5e9-75c4-4839-aaea-56c4890d632f'));
    expect((await handler(event)).statusCode).toBe(403);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(String(upstream.mock.calls[0][0])).toBe('https://test.supabase.co/auth/v1/user');
  });

  it('keeps the line intact and streams no key to the audio host or browser', async () => {
    upstream.mockResolvedValueOnce(auth()).mockResolvedValueOnce(output())
      .mockResolvedValueOnce(new Response(wave));
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    expect(result.isBase64Encoded).toBe(true);
    expect(result.body).toBe(wave.toString('base64'));
    expect(result.headers['Content-Type']).toBe('audio/wav');
    const [, synthesis, audio] = upstream.mock.calls;
    expect(JSON.parse(synthesis[1].body)).toMatchObject({
      model: 'qwen-audio-3.1-tts-flash',
      input: { text, format: 'wav', voice: 'Andy_v3.1', instruction: expect.any(String) },
    });
    expect(String(audio[0])).toBe(objectUrl.replace('http:', 'https:'));
    expect(audio[1].headers).toBeUndefined();
    expect(audio[1].redirect).toBe('error');
  });

  it('refuses an unexpected audio host before downloading it', async () => {
    upstream.mockResolvedValueOnce(auth()).mockResolvedValueOnce(output('https://example.org/audio.wav'));
    expect((await handler(event)).statusCode).toBe(502);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('accepts the provider streaming size markers with complete PCM frames', async () => {
    const streamed = pcmWave(true);
    upstream.mockResolvedValueOnce(auth()).mockResolvedValueOnce(output())
      .mockResolvedValueOnce(new Response(streamed));
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe(streamed.toString('base64'));
  });

  it.each([
    ['missing format and data', () => {
      const malformed = Buffer.alloc(48);
      malformed.write('RIFF');
      malformed.writeUInt32LE(40, 4);
      malformed.write('WAVE', 8);
      return malformed;
    }],
    ['truncated declared data', () => {
      const malformed = pcmWave();
      malformed.writeUInt32LE(6, 40);
      return malformed;
    }],
    ['incomplete streamed PCM frame', () => pcmWave(true).subarray(0, 47)],
  ] as const)('refuses WAV data with %s', async (_, fixture) => {
    upstream.mockResolvedValueOnce(auth()).mockResolvedValueOnce(output())
      .mockResolvedValueOnce(new Response(fixture()));
    expect(await handler(event)).toMatchObject({
      statusCode: 502,
      body: JSON.stringify({ code: 'TTS_UNAVAILABLE' }),
    });
  });
});
