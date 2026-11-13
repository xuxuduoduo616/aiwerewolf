/**
 * Speech-to-text adapter for the optional push-to-talk voice input.
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

  try {
    const body = JSON.stringify({
      audio: await audioToDataUrl(audio),
      lang,
      durationMs: clampDurationMs(options.durationMs),
    });

    if (controller.signal.aborted) {
      throw new SttError(timedOut ? 'timeout' : callerSignal?.aborted ? 'aborted' : 'unavailable');
    }

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
    return { text: text.trim() };
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
