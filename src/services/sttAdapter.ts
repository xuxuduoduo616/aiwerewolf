/**
 * Speech-to-text adapter for the optional click-to-record voice input.
 *
 * Audio is sent to the same-origin Netlify function only. This module never
 * imports or calls the LLM/TTS proxies, and the browser never holds the ASR
 * provider key — the function reads it from the server environment.
 */
import type { DisplayLanguage } from '../i18n';

export type SttLanguage = 'en-US' | 'zh-CN';

export interface SttResult {
  text: string;
}

export interface TranscribeOptions {
  /** Cancels the in-flight request (component cancel / visibility loss). */
  signal?: AbortSignal;
  /** Recorded length; the function rejects recordings longer than 60s. */
  durationMs?: number;
}

export type TranscribeAudio = (
  audio: Blob,
  lang: SttLanguage,
  options?: TranscribeOptions,
) => Promise<SttResult>;

export interface SttAdapter {
  lang: SttLanguage;
  transcribe: (audio: Blob, options?: TranscribeOptions) => Promise<SttResult>;
}

/** Same-origin endpoint; CSP `connect-src 'self'` already covers it. */
export const STT_ENDPOINT = '/.netlify/functions/asr-transcribe';
/** Client budget: the function itself aborts its provider call at 12s. */
export const STT_TIMEOUT_MS = 15_000;
/** Aligned with `SPEECH_DURATION = 60` in src/hooks/useGameState.ts (L289). */
export const MAX_RECORDING_MS = 60_000;

export type SttErrorCode = 'timeout' | 'aborted' | 'unavailable';

/** Typed failure so the UI can map each category to one visible message. */
export class SttError extends Error {
  readonly code: SttErrorCode;

  constructor(code: SttErrorCode) {
    super(`stt:${code}`);
    this.name = 'SttError';
    this.code = code;
  }
}

export const toSttLanguage = (language: DisplayLanguage): SttLanguage =>
  language === 'zh' ? 'zh-CN' : 'en-US';

const clampDurationMs = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_RECORDING_MS, Math.round(value));
};

/** Standard base64 without Buffer (the browser bundle must stay dependency-free). */
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

export const audioToDataUrl = async (audio: Blob): Promise<string> => {
  const bytes = new Uint8Array(await audio.arrayBuffer());
  if (bytes.length === 0) throw new SttError('unavailable');
  const type = audio.type || 'audio/wav';
  return `data:${type};base64,${bytesToBase64(bytes)}`;
};

export interface CloudTranscribeOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
}

/**
 * Default transport: POST `{ audio: data URL, lang, durationMs }` to the
 * same-origin function and return its `{ text }` payload.
 */
export interface WavChunk {
  dataUrl: string;
  durationMs: number;
}

const WAV_CHUNK_MS = 3_200;
const WAV_OVERLAP_MS = 200;
const WAV_SAMPLE_RATE = 16_000;

const ascii = (bytes: Uint8Array, offset: number, length: number): string =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

const readU16 = (bytes: Uint8Array, offset: number): number =>
  bytes[offset] | (bytes[offset + 1] << 8);

const readU32 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

const makeWav = (pcm: Uint8Array): Uint8Array => {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const put = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) out[offset + index] = text.charCodeAt(index);
  };
  put(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
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
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
};

/**
 * Splits a 16 kHz mono PCM16 WAV into overlapping short requests. Each request
 * must stay below the Netlify synchronous-function budget; the server then
 * calls Qwen once per chunk. Non-WAV audio is left for the single-request path.
 */
export const splitWavIntoChunks = (bytes: Uint8Array): WavChunk[] | null => {
  if (bytes.length < 44 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;

  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let dataOffset = -1;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const id = ascii(bytes, offset, 4);
    const size = readU32(bytes, offset + 4);
    const body = offset + 8;
    if (body + size > bytes.length) break;
    if (id === 'fmt ' && size >= 16) {
      fmt = {
        format: readU16(bytes, body),
        channels: readU16(bytes, body + 2),
        rate: readU32(bytes, body + 4),
        bits: readU16(bytes, body + 14),
      };
    }
    if (id === 'data') {
      dataOffset = body;
      dataLength = size;
      break;
    }
    offset = body + size + (size % 2);
  }

  if (!fmt || fmt.format !== 1 || fmt.channels !== 1 || fmt.bits !== 16
    || fmt.rate !== WAV_SAMPLE_RATE || dataOffset < 0 || dataLength < 2) {
    return null;
  }

  const chunkBytes = Math.floor((fmt.rate * WAV_CHUNK_MS) / 1000) * 2;
  const overlapBytes = Math.floor((fmt.rate * WAV_OVERLAP_MS) / 1000) * 2;
  const stepBytes = Math.max(2, chunkBytes - overlapBytes);
  const chunks: WavChunk[] = [];
  for (let start = 0; start < dataLength; start += stepBytes) {
    const end = Math.min(start + chunkBytes, dataLength);
    const pcm = bytes.subarray(dataOffset + start, dataOffset + end);
    if (pcm.length < 2) break;
    const wav = makeWav(pcm);
    chunks.push({
      dataUrl: `data:audio/wav;base64,${bytesToBase64(wav)}`,
      durationMs: Math.min(MAX_RECORDING_MS, Math.round((pcm.length / 2 / fmt.rate) * 1000)),
    });
    if (end === dataLength) break;
  }
  return chunks;
};

/** Joins overlapping chunk transcripts, removing a duplicated word suffix/prefix. */
export const mergeTranscripts = (texts: string[]): string => {
  let merged = '';
  for (const raw of texts) {
    const next = raw.trim();
    if (!next) continue;
    if (!merged) {
      merged = next;
      continue;
    }
    const previousWords = merged.split(/\s+/);
    const nextWords = next.split(/\s+/);
    let overlap = Math.min(previousWords.length, nextWords.length, 8);
    for (; overlap > 0; overlap -= 1) {
      const left = previousWords.slice(-overlap).join(' ').toLowerCase();
      const right = nextWords.slice(0, overlap).join(' ').toLowerCase();
      if (left === right) break;
    }
    const remainder = nextWords.slice(overlap).join(' ');
    if (remainder) merged += ` ${remainder}`;
  }
  return merged.replace(/\s+/g, ' ').trim();
};

/**
 * Default transport: POST `{ audio: data URL, lang, durationMs }` to the
 * same-origin function and return its `{ text }` payload.
 *
 * WAV recordings longer than ~3s are split into short, overlapping requests so
 * each serverless invocation stays inside the platform timeout. Each chunk is
 * still a single-shot Qwen HTTPS request; no audio is sent anywhere else.
 */
export const createCloudTranscribe = ({
  fetchImpl = (input, init) => fetch(input, init),
  endpoint = STT_ENDPOINT,
  timeoutMs = STT_TIMEOUT_MS,
}: CloudTranscribeOptions = {}): TranscribeAudio => async (audio, lang, options = {}) => {
  const callerSignal = options.signal;
  if (callerSignal?.aborted) throw new SttError('aborted');

  const controller = new AbortController();
  let timedOut = false;
  const abortForCaller = () => controller.abort();
  callerSignal?.addEventListener('abort', abortForCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const post = async (dataUrl: string, durationMs: number): Promise<string> => {
    if (controller.signal.aborted) {
      throw new SttError(timedOut ? 'timeout' : callerSignal?.aborted ? 'aborted' : 'unavailable');
    }
    const body = JSON.stringify({
      audio: dataUrl,
      lang,
      durationMs: clampDurationMs(durationMs),
    });

    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
    } catch {
      if (timedOut) throw new SttError('timeout');
      if (callerSignal?.aborted) throw new SttError('aborted');
      throw new SttError('unavailable');
    }

    if (!response.ok) throw new SttError('unavailable');

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SttError('unavailable');
    }
    if (!payload || typeof payload !== 'object') throw new SttError('unavailable');
    const text = (payload as { text?: unknown }).text;
    if (typeof text !== 'string') throw new SttError('unavailable');
    return text.trim();
  };

  try {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const chunks = splitWavIntoChunks(bytes);
    if (chunks && chunks.length > 1) {
      const texts = await Promise.all(chunks.map(chunk => post(chunk.dataUrl, chunk.durationMs)));
      return { text: mergeTranscripts(texts) };
    }
    return { text: await post(await audioToDataUrl(audio), options.durationMs ?? 0) };
  } catch (error) {
    if (error instanceof SttError) throw error;
    if (timedOut) throw new SttError('timeout');
    if (callerSignal?.aborted) throw new SttError('aborted');
    throw new SttError('unavailable');
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortForCaller);
  }
};

export interface CreateSttAdapterOptions {
  lang: SttLanguage;
  /** Injected fake transcriber for tests / alternate transports. */
  transcribe?: TranscribeAudio;
  fetchImpl?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
}

/** Replaceable factory: the component only depends on this contract. */
export const createSttAdapter = ({
  lang,
  transcribe,
  fetchImpl,
  endpoint,
  timeoutMs,
}: CreateSttAdapterOptions): SttAdapter => {
  const run = transcribe
    ?? createCloudTranscribe({ fetchImpl, endpoint, timeoutMs });
  return {
    lang,
    transcribe: (audio, options) => run(audio, lang, options),
  };
};
