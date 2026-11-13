import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RECORDING_MS,
  STT_ENDPOINT,
  SttError,
  audioToDataUrl,
  createCloudTranscribe,
  createSttAdapter,
  toSttLanguage,
} from './sttAdapter';

const audio = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' });

const ok = (payload: unknown) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const makeWav = (seconds: number): Blob => {
  const rate = 16_000;
  const dataLength = rate * seconds * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const put = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index);
  };
  put(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, dataLength, true);
  return new Blob([bytes], { type: 'audio/wav' });
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sttAdapter contract', () => {
  it('maps the display language to the ASR language tag', () => {
    expect(toSttLanguage('en')).toBe('en-US');
    expect(toSttLanguage('zh')).toBe('zh-CN');
    expect(STT_ENDPOINT).toBe('/.netlify/functions/asr-transcribe');
    expect(MAX_RECORDING_MS).toBe(60_000);
  });

  it('keeps the injected transcriber replaceable and language-bound', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: '  hello  ' });
    const adapter = createSttAdapter({ lang: 'zh-CN', transcribe });

    const result = await adapter.transcribe(audio, { durationMs: 900, signal: new AbortController().signal });

    expect(result).toEqual({ text: '  hello  ' });
    expect(adapter.lang).toBe('zh-CN');
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0][1]).toBe('zh-CN');
    expect(transcribe.mock.calls[0][2]).toMatchObject({ durationMs: 900 });
  });

  it('encodes the recording as a data URL for the same-origin function', async () => {
    await expect(audioToDataUrl(audio)).resolves.toBe('data:audio/wav;base64,AQIDBA==');
  });
});

describe('cloud transcribe', () => {
  it('posts only the audio, language and duration to the same-origin endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ text: '  I trust Player 4.  ' }));
    const transcribe = createCloudTranscribe({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(transcribe(audio, 'en-US', { durationMs: 1234.6 })).resolves.toEqual({
      text: 'I trust Player 4.',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(STT_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      audio: 'data:audio/wav;base64,AQIDBA==',
      lang: 'en-US',
      durationMs: 1235,
    });
  });

  it('splits a long WAV into short same-origin requests and merges the text', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ok({ text: 'Player four is suspicious' }));
    const transcribe = createCloudTranscribe({ fetchImpl: fetchMock as unknown as typeof fetch });

    const result = await transcribe(makeWav(7), 'en-US', { durationMs: 7_000 });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    for (const body of bodies) {
      expect(body.audio).toMatch(/^data:audio\/wav;base64,/);
      expect(body.durationMs).toBeLessThanOrEqual(4_000);
    }
    expect(result.text).toContain('Player four is suspicious');
  });

  it('clamps an over-long duration so the function can reject it consistently', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ text: 'x' }));
    const transcribe = createCloudTranscribe({ fetchImpl: fetchMock as unknown as typeof fetch });

    await transcribe(audio, 'zh-CN', { durationMs: 120_000 });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ durationMs: 60_000 });
  });

  it('returns an empty string for a silent recording instead of inventing text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok({ text: '   ' }));
    const transcribe = createCloudTranscribe({ fetchImpl: fetchMock as unknown as typeof fetch });

    await expect(transcribe(audio, 'en-US', { durationMs: 800 })).resolves.toEqual({ text: '' });
  });

  it.each([
    ['rate limited', new Response('', { status: 429 })],
    ['temporarily unavailable', new Response('', { status: 502 })],
    ['service unavailable', new Response('', { status: 503 })],
  ])('maps HTTP %s to one typed unavailable error', async (_label, response) => {
    const transcribe = createCloudTranscribe({
      fetchImpl: vi.fn().mockResolvedValue(response) as unknown as typeof fetch,
    });

    await expect(transcribe(audio, 'en-US', { durationMs: 800 })).rejects.toMatchObject({
      name: 'SttError',
      code: 'unavailable',
    });
  });

  it('rejects an unreadable success payload as unavailable', async () => {
    const transcribe = createCloudTranscribe({
      fetchImpl: vi.fn().mockResolvedValue(new Response('not json', { status: 200 })) as unknown as typeof fetch,
    });

    await expect(transcribe(audio, 'en-US', { durationMs: 800 })).rejects.toBeInstanceOf(SttError);
  });

  it('aborts the request after the 15s budget and reports a timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const transcribe = createCloudTranscribe({ fetchImpl: fetchMock as unknown as typeof fetch });

    const pending = transcribe(audio, 'en-US', { durationMs: 800 });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'SttError', code: 'timeout' });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a caller cancellation as aborted and never resolves text', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const transcribe = createCloudTranscribe({ fetchImpl: fetchMock as unknown as typeof fetch });
    const caller = new AbortController();

    const pending = transcribe(audio, 'en-US', { durationMs: 800, signal: caller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'SttError', code: 'aborted' });
  });

  it('reports network failure as unavailable', async () => {
    const transcribe = createCloudTranscribe({
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch,
    });

    await expect(transcribe(audio, 'en-US', { durationMs: 800 })).rejects.toMatchObject({
      code: 'unavailable',
    });
  });
});
