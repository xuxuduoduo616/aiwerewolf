import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RECORDING_MS,
  STT_ENDPOINT,
  SttError,
  audioToDataUrl,
  createCloudTranscribe,
  createSttAdapter,
  mergeTranscripts,
  splitWavIntoChunks,
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

// Long-recording boundary: the constants below mirror the private
// `WAV_CHUNK_MS` / `WAV_OVERLAP_MS` / `WAV_SAMPLE_RATE` in sttAdapter.ts
// (L94-L96). If those constants change, this plan must change with them.
const WAV_SAMPLE_RATE = 16_000;
const WAV_HEADER_BYTES = 44;
const PLAN_CHUNK_MS = 3_200;
const PLAN_OVERLAP_MS = 200;
const PLAN_STEP_MS = PLAN_CHUNK_MS - PLAN_OVERLAP_MS;

/**
 * 16 kHz mono PCM16 WAV whose 16-bit sample value is the absolute sample index
 * (mod 2^15). A decoded chunk therefore proves exactly where it starts, which
 * is how the split plan is asserted without exposing private helpers.
 */
const makeIndexedWav = (durationMs: number): Uint8Array<ArrayBuffer> => {
  const sampleCount = Math.round((WAV_SAMPLE_RATE * durationMs) / 1000);
  const dataLength = sampleCount * 2;
  const bytes = new Uint8Array(WAV_HEADER_BYTES + dataLength);
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
  view.setUint32(24, WAV_SAMPLE_RATE, true);
  view.setUint32(28, WAV_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  put(36, 'data');
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < sampleCount; index += 1) {
    view.setInt16(WAV_HEADER_BYTES + index * 2, index % 0x8000, true);
  }
  return bytes;
};

/** Decodes one posted chunk and proves it is still 16 kHz mono PCM16 WAV. */
const decodeWavChunk = (dataUrl: string): { sampleCount: number; firstSample: number } => {
  const match = /^data:audio\/wav;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error(`expected a base64 WAV data URL, got: ${dataUrl.slice(0, 40)}`);
  const binary = atob(match[1]);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  expect(ascii(0, 4)).toBe('RIFF');
  expect(ascii(8, 4)).toBe('WAVE');
  expect(ascii(12, 4)).toBe('fmt ');
  expect(view.getUint16(20, true)).toBe(1); // PCM
  expect(view.getUint16(22, true)).toBe(1); // mono
  expect(view.getUint32(24, true)).toBe(WAV_SAMPLE_RATE);
  expect(view.getUint16(34, true)).toBe(16); // bits per sample
  expect(ascii(36, 4)).toBe('data');
  const dataLength = view.getUint32(40, true);
  expect(bytes.length).toBe(WAV_HEADER_BYTES + dataLength);

  return {
    sampleCount: dataLength / 2,
    firstSample: view.getInt16(WAV_HEADER_BYTES, true),
  };
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

describe('full 60s recording boundary', () => {
  const expectedChunks = Math.floor((MAX_RECORDING_MS - 1) / PLAN_STEP_MS) + 1;

  it('plans a full 60s WAV as exactly 20 overlapping 3.2s chunks', () => {
    // plan for the current constants: step 3,000ms over 60,000ms.
    // floor((60,000 - 1) / 3,000) + 1 = floor(19.99…) + 1 = 20 chunks
    // (19 × 3,200ms + last 3,000ms; every neighbour overlaps by 200ms).
    expect(expectedChunks).toBe(20);

    const chunks = splitWavIntoChunks(makeIndexedWav(MAX_RECORDING_MS));
    expect(chunks).not.toBeNull();
    if (!chunks) throw new Error('a 16 kHz mono PCM16 WAV must be split into chunks');
    expect(chunks).toHaveLength(expectedChunks);

    const ranges = chunks.map((chunk, index) => {
      const decoded = decodeWavChunk(chunk.dataUrl);
      const startMs = index * PLAN_STEP_MS;
      const durationMs = (decoded.sampleCount * 1000) / WAV_SAMPLE_RATE;

      // The encoded sample value proves the chunk starts at the planned offset.
      expect(decoded.firstSample).toBe((startMs * WAV_SAMPLE_RATE / 1000) % 0x8000);
      expect(chunk.durationMs).toBe(durationMs);
      expect(durationMs).toBeGreaterThan(0);
      expect(durationMs).toBeLessThanOrEqual(PLAN_CHUNK_MS);
      expect(durationMs).toBe(
        index === expectedChunks - 1
          ? MAX_RECORDING_MS - (expectedChunks - 1) * PLAN_STEP_MS
          : PLAN_CHUNK_MS,
      );

      return { startMs, endMs: startMs + durationMs };
    });

    // Consecutive coverage: the first chunk starts at 0, every next chunk
    // starts one step later, neighbours overlap by exactly 200ms, and the last
    // chunk ends on the 60,000ms boundary (nothing is dropped).
    expect(ranges[0]).toEqual({ startMs: 0, endMs: PLAN_CHUNK_MS });
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index].startMs - ranges[index - 1].startMs).toBe(PLAN_STEP_MS);
      expect(ranges[index - 1].endMs - ranges[index].startMs).toBe(PLAN_OVERLAP_MS);
    }
    expect(ranges[ranges.length - 1].endMs).toBe(MAX_RECORDING_MS);
  });

  it('uploads a full 60s recording as 20 same-origin chunks and merges their text in order', async () => {
    const chunkText = (index: number): string => {
      if (index === 0) return 'Voice0 bridge0';
      if (index === expectedChunks - 1) return `bridge${index - 1} Voice${index}`;
      return `bridge${index - 1} Voice${index} bridge${index}`;
    };
    const expectedText = [
      ...Array.from({ length: expectedChunks - 1 }, (_, index) => `Voice${index} bridge${index}`),
      `Voice${expectedChunks - 1}`,
    ].join(' ');

    const requests: { url: string; body: { audio: string; durationMs: number; lang: string } }[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        audio: string;
        durationMs: number;
        lang: string;
      };
      requests.push({ url, body });
      return ok({ text: chunkText(requests.length - 1) });
    });
    const transcribe = createCloudTranscribe({ fetchImpl: fetchMock as unknown as typeof fetch });

    const result = await transcribe(
      new Blob([makeIndexedWav(MAX_RECORDING_MS)], { type: 'audio/wav' }),
      'zh-CN',
      { durationMs: MAX_RECORDING_MS },
    );

    expect(fetchMock).toHaveBeenCalledTimes(expectedChunks);
    expect(requests).toHaveLength(expectedChunks);
    expect(requests.every(request => request.url === STT_ENDPOINT)).toBe(true);

    requests.forEach(({ body }, index) => {
      expect(Object.keys(body).sort()).toEqual(['audio', 'durationMs', 'lang']);
      expect(body.lang).toBe('zh-CN');
      expect(body.durationMs).toBeGreaterThan(0);
      expect(body.durationMs).toBeLessThanOrEqual(3_500);

      // Requests are dispatched in chunk order and each audio body is the
      // planned 16 kHz WAV slice.
      const decoded = decodeWavChunk(body.audio);
      expect(decoded.firstSample).toBe((index * PLAN_STEP_MS * WAV_SAMPLE_RATE / 1000) % 0x8000);
      expect((decoded.sampleCount * 1000) / WAV_SAMPLE_RATE).toBe(body.durationMs);
    });
    expect(requests[requests.length - 1].body.durationMs).toBe(3_000);

    // Merged once, in chunk order, with each duplicated boundary word removed.
    expect(result.text).toBe(expectedText);
  });

  it('removes a duplicated word at the overlap boundary of adjacent transcripts', () => {
    expect(mergeTranscripts(['we saw player four', 'player four is suspicious']))
      .toBe('we saw player four is suspicious');
    expect(mergeTranscripts(['   ', 'only text', ''])).toBe('only text');
  });
});
