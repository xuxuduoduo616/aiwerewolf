import { recordTtsOutcome } from './matchTelemetry';

type PlaybackResult = 'finished' | 'fallback' | 'interrupted' | 'cancelled';
type BrowserFallback = { text: string; maxDurationMs?: number };

const isAbortError = (error: unknown): boolean => Boolean(error) && typeof error === 'object'
  && ['AbortError', 'TimeoutError'].includes(String((error as { name?: unknown }).name));

/** Soft client target; the provider still accepts up to 600 code points. */
export const CLOUD_SPEECH_LIMIT = 360;
/** Provider accepts up to 600 code points per request. */
export const CLOUD_SPEECH_SERVER_LIMIT = 600;
/** English synthesis routinely takes >5.5s; leave room for slow provider turns. */
export const ENGLISH_REQUEST_TIMEOUT_MS = 22_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 6_500;
export const PLAYBACK_START_TIMEOUT_MS = 6_500;

/**
 * Partition a long payload into provider-sized clips. Every Unicode code point
 * is preserved exactly once, and each clip keeps at least one non-space
 * character. Sentence and word boundaries are preferred; a single long token
 * is split only when there is no other choice.
 */
export function splitCloudSpeech(text: string): string[] | null {
  const points = [...text];
  if (!points.length || !text.trim()) return null;
  const spaces = points.map(point => /\s/u.test(point));
  const sentenceEnds = new Set<number>();
  let afterTerminal = false;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (afterTerminal) {
      if (/[\p{Pe}\p{Pf}"'”’]/u.test(point)) continue; // closing quote/bracket
      sentenceEnds.add(i);
      afterTerminal = false;
    }
    if (/[。！？；]/u.test(point) || (/\p{Sentence_Terminal}/u.test(point) && (i + 1 === points.length || spaces[i + 1]))) {
      afterTerminal = true;
    }
  }

  // Work backwards so a preferred boundary never strands an unsendable suffix.
  const next = new Array<number>(points.length + 1).fill(0);
  next[points.length] = points.length;
  let firstContent = points.length;
  for (let start = points.length - 1; start >= 0; start--) {
    if (!spaces[start]) firstContent = start;
    const limit = Math.min(start + CLOUD_SPEECH_LIMIT, points.length);
    let hardBoundary = 0;
    let wordBoundary = 0;
    for (let end = limit; end > firstContent; end--) {
      if (!next[end]) continue;
      if (end === points.length || sentenceEnds.has(end)) {
        wordBoundary = end;
        break;
      }
      if (!wordBoundary && (spaces[end] || spaces[end - 1])) wordBoundary = end;
      if (!hardBoundary) hardBoundary = end;
    }
    next[start] = wordBoundary || hardBoundary;
  }
  if (!next[0]) return null;
  const clips: string[] = [];
  for (let start = 0; start < points.length; start = next[start]) {
    clips.push(points.slice(start, next[start]).join(''));
  }
  return clips;
}

interface CloudSpeech {
  text: string;
  lang: string;
  seat: number;
  accessToken: string;
  volume: number;
  rate: number;
  maxPlaybackMs: number;
  requestTimeoutMs?: number;
}

/** One cancellable request and player, with separate request/playback deadlines. */
function playCloudClip(options: CloudSpeech) {
  const controller = new AbortController();
  const requestTimeoutMs = options.requestTimeoutMs
    ?? (options.lang === 'zh-CN' ? DEFAULT_REQUEST_TIMEOUT_MS : ENGLISH_REQUEST_TIMEOUT_MS);
  let player: HTMLAudioElement | undefined;
  let url: string | undefined;
  let settled = false;
  let paused = false;
  let deferred: PlaybackResult | undefined;
  let attempt = 0;
  let started = false;
  let requesting = true;
  let requestDeadline = Date.now() + requestTimeoutMs;
  let requestRemaining = requestTimeoutMs;
  let playbackDeadline: number | undefined;
  let playbackRemaining = options.maxPlaybackMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult!: (result: PlaybackResult) => void;
  const result = new Promise<PlaybackResult>(resolve => { resolveResult = resolve; });

  const finish = (outcome: PlaybackResult) => {
    if (settled) return;
    if (paused && outcome !== 'cancelled') {
      deferred ??= outcome;
      clearTimeout(timer);
      return; // keep the in-flight request/player until resume
    }
    settled = true;
    clearTimeout(timer);
    controller.abort();
    if (player) {
      player.onplaying = player.onended = player.onerror = null;
      player.pause();
      player.removeAttribute('src');
      player.load();
    }
    if (url) URL.revokeObjectURL(url);
    resolveResult(outcome);
  };

  const fail = () => finish(started || (player?.currentTime ?? 0) > 0 ? 'interrupted' : 'fallback');

  const play = () => {
    if (!player || paused || settled) return;
    const id = ++attempt;
    clearTimeout(timer);
    timer = setTimeout(fail, PLAYBACK_START_TIMEOUT_MS);
    void player.play().catch(() => {
      if (attempt === id && !paused) fail();
    });
  };

  const armRequestTimer = (ms: number) => {
    requestRemaining = ms;
    requestDeadline = Date.now() + ms;
    timer = setTimeout(() => {
      if (requesting) recordTtsOutcome('tts_timeout');
      requesting = false;
      fail();
    }, ms);
  };
  armRequestTimer(requestTimeoutMs);

  void (async () => {
    try {
      const response = await fetch('/.netlify/functions/bailian-tts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: options.text, lang: options.lang, seat: options.seat }),
        redirect: 'error',
        signal: controller.signal,
      });
      if (settled || deferred) return;
      if (!response.ok) {
        requesting = false;
        recordTtsOutcome(response.status === 429 ? 'tts_rate_limited' : 'tts_unavailable');
        finish('fallback');
        return;
      }
      if (response.headers.get('content-type') !== 'audio/wav') {
        requesting = false;
        recordTtsOutcome('tts_invalid_media');
        finish('fallback');
        return;
      }
      const audio = await response.blob();
      if (settled || deferred) return;
      requesting = false;
      clearTimeout(timer);
      recordTtsOutcome('tts_success');
      url = URL.createObjectURL(audio);
      player = new Audio(url);
      player.volume = options.volume;
      player.playbackRate = options.rate;
      player.onplaying = () => {
        started = true;
        if (paused || settled || playbackDeadline !== undefined) return;
        clearTimeout(timer);
        playbackDeadline = Date.now() + playbackRemaining;
        timer = setTimeout(() => finish('finished'), playbackRemaining);
      };
      player.onended = () => finish('finished');
      player.onerror = fail;
      play();
    } catch (error) {
      if (settled || deferred) return;
      requesting = false;
      recordTtsOutcome(isAbortError(error) ? 'tts_timeout' : 'tts_unavailable');
      finish('fallback');
    }
  })();

  return {
    result,
    cancel: () => finish('cancelled'),
    pause: () => {
      if (paused || settled) return;
      paused = true;
      attempt++;
      if (requesting) {
        requestRemaining = Math.max(0, requestDeadline - Date.now());
        clearTimeout(timer);
      }
      if (playbackDeadline !== undefined) {
        playbackRemaining = Math.max(0, playbackDeadline - Date.now());
        playbackDeadline = undefined;
      }
      if (player) {
        clearTimeout(timer);
        player.pause();
      }
    },
    resume: () => {
      if (!paused || settled) return;
      paused = false;
      if (deferred) {
        finish(deferred);
      } else if (requesting) {
        armRequestTimer(requestRemaining);
      } else {
        play();
      }
    },
  };
}

/** One logical turn, with at most one live clip and a shared, pause-aware deadline. */
export function playCloudSpeech(options: CloudSpeech, chunks?: string[]) {
  if (!chunks) {
    const clip = playCloudClip(options);
    return {
      ...clip,
      result: clip.result.then((outcome): BrowserFallback | null =>
        outcome === 'fallback' || outcome === 'interrupted' ? { text: options.text } : null),
    };
  }

  let index = 0;
  let active: ReturnType<typeof playCloudClip> | undefined;
  let pending: PlaybackResult | undefined;
  let paused = false;
  let settled = false;
  let remaining = options.maxPlaybackMs;
  let deadline = Date.now() + remaining;
  let timer: ReturnType<typeof setTimeout>;
  let resolveResult!: (fallback: BrowserFallback | null) => void;
  const result = new Promise<BrowserFallback | null>(resolve => { resolveResult = resolve; });

  const finish = (fallback: BrowserFallback | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    active?.cancel();
    resolveResult(fallback);
  };
  const advance = () => {
    if (paused || settled) return;
    if (pending === 'cancelled') {
      finish(null);
      return;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      finish(null);
      return;
    }
    if (pending === 'fallback' || pending === 'interrupted') {
      // Once a clip starts, its exact spoken offset is unknown. Skip that
      // clip's remainder and send only the unplayed suffix to browser speech.
      const start = pending === 'interrupted' ? index + 1 : index;
      const text = chunks.slice(start).join('');
      finish(text ? { text, maxDurationMs: remainingMs } : null);
      return;
    }
    if (pending === 'finished') index++;
    if (index === chunks.length) {
      finish(null);
      return;
    }
    pending = undefined;
    active = playCloudClip({ ...options, text: chunks[index], maxPlaybackMs: remainingMs });
    void active.result.then(outcome => {
      active = undefined;
      pending = outcome;
      advance();
    });
  };
  timer = setTimeout(() => finish(null), remaining);
  advance();
  return {
    result,
    cancel: () => finish(null),
    pause: () => {
      if (paused || settled) return;
      paused = true;
      remaining = Math.max(0, deadline - Date.now());
      clearTimeout(timer);
      active?.pause();
    },
    resume: () => {
      if (!paused || settled) return;
      paused = false;
      deadline = Date.now() + remaining;
      timer = setTimeout(() => finish(null), remaining);
      if (active) active.resume();
      else advance();
    },
  };
}
