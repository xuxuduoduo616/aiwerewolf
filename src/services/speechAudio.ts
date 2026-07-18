/**
 * speechAudio — centralized browser audio service (card: browser-tts-mvp).
 *
 * SINGLE entry point for all TTS: components and hooks NEVER call
 * `window.speechSynthesis` directly — only this module (grep-verifiable).
 *
 * Owns:
 *  - a single queue, max one active utterance; a new enqueue cancels the
 *    current one (single speaker at a time);
 *  - per-log-ID dedupe (`GameLog.id`): each log is spoken at most once across
 *    rerenders (play-once, marked at enqueue commit — a cancelled speech is
 *    never replayed);
 *  - stable voice per playerId: deterministic charCode hash into the
 *    same-language voice list, falling back to any voice, then the browser's
 *    lang default; recomputed when `voiceschanged` fires or the assigned
 *    voice disappears;
 *  - Chrome async-voice-load handling: `getVoices()` is kicked at module load
 *    and re-read live on every enqueue, so an initially-empty list never
 *    binds permanently;
 *  - hard max duration per utterance (`speechMaxDurationMs`) — TTS is
 *    presentation-only and never blocks or extends game timing;
 *  - graceful no-op when the API is absent: every public method is safe to
 *    call unconditionally;
 *  - a restrained vote-countdown tick beep (WebAudio oscillator, no file).
 *
 * Testability (repo convention: no jsdom): the browser backend is resolved
 * through an injectable provider — tests inject a speechSynthesis-like object
 * and utterance constructor via `__test.inject`.
 */

import type { DisplayLanguage } from '../i18n';
import { detectLanguage } from './translationService';

// ─── Backend shapes (structural — satisfied by the real browser API) ─────────

export interface VoiceLike {
  name: string;
  lang: string;
  voiceURI: string;
  default: boolean;
}

export interface UtteranceLike {
  text: string;
  lang: string;
  volume: number;
  rate: number;
  voice: VoiceLike | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

export interface SynthLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  getVoices(): VoiceLike[];
  addEventListener?(type: 'voiceschanged', listener: () => void): void;
}

export type UtteranceCtor = new (text: string) => UtteranceLike;

// ─── Module state ────────────────────────────────────────────────────────────

const prefs = {
  muted: false,
  volume: 1, // 0–1
  rate: 1,   // 0.5–2
  enabled: false, // AI-voice toggle; flipping it on is the user gesture
};

/** Log ids already committed to speech (play-once dedupe). */
const spokenIds = new Set<string>();

/** Active utterance + its settle function (null when idle). */
let current: { utterance: UtteranceLike; finish: () => void } | null = null;

/** Per-`playerId:lang` voice assignment, invalidated on voiceschanged. */
const voiceCache = new Map<string, VoiceLike>();

/** Test injection (undefined = use the real browser API). */
let injectedSynth: SynthLike | null | undefined = undefined;
let injectedCtor: UtteranceCtor | null | undefined = undefined;

let voicesInitDone = false;

// ─── Backend resolution ──────────────────────────────────────────────────────

const getSynth = (): SynthLike | null => {
  if (injectedSynth !== undefined) return injectedSynth;
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    return window.speechSynthesis as unknown as SynthLike;
  }
  return null;
};

const getUtteranceCtor = (): UtteranceCtor | null => {
  if (injectedCtor !== undefined) return injectedCtor;
  if (typeof window !== 'undefined' && 'SpeechSynthesisUtterance' in window) {
    return window.SpeechSynthesisUtterance as unknown as UtteranceCtor;
  }
  return null;
};

// ─── Voices (Chrome loads the list asynchronously) ───────────────────────────

const onVoicesChanged = (): void => {
  voiceCache.clear(); // recompute assignments against the new list
};

/** Kick the async voice load and subscribe to list changes (once). */
const ensureVoicesInit = (): void => {
  if (voicesInitDone) return;
  const synth = getSynth();
  if (!synth) return;
  voicesInitDone = true;
  try {
    synth.getVoices(); // first call triggers Chrome's async load
    if (typeof synth.addEventListener === 'function') {
      synth.addEventListener('voiceschanged', onVoicesChanged);
    } else if ('onvoiceschanged' in synth) {
      (synth as { onvoiceschanged: unknown }).onvoiceschanged = onVoicesChanged;
    }
  } catch {
    // Voice metadata is best-effort — speech still works via utterance.lang.
  }
};

// ─── Pure decision helpers (exported for tests) ──────────────────────────────

/** Deterministic non-negative hash of a playerId string (charCode-based). */
export const hashPlayerId = (playerId: string): number => {
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash * 31 + playerId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

/** Stable voice index for a playerId, or -1 when no voices exist. */
export const pickVoiceIndex = (playerId: string, voiceCount: number): number =>
  voiceCount > 0 ? hashPlayerId(playerId) % voiceCount : -1;

/** Voices whose lang shares the primary subtag (zh-CN matches zh-TW etc.). */
export const sameLanguageVoices = (voices: VoiceLike[], lang: string): VoiceLike[] => {
  const prefix = lang.split('-')[0].toLowerCase();
  return voices.filter(voice => voice.lang?.toLowerCase().startsWith(prefix));
};

/**
 * Hard max speech duration: per-char allowance with a 5s floor. TTS is
 * presentation-only — the AI turn falls back to text timing after this cap.
 */
export const speechMaxDurationMs = (text: string): number =>
  Math.max(text.length * 30, 5000);

/**
 * BCP-47 tag for an utterance: detect the text's own language first (the
 * displayed text may legitimately be zh in EN mode via the canned-stub
 * fallback), then fall back to the game display language.
 */
export const speechLangTag = (text: string, language: DisplayLanguage): string => {
  const detected = detectLanguage(text);
  if (detected === 'zh') return 'zh-CN';
  if (detected === 'en') return 'en-US';
  return language === 'zh' ? 'zh-CN' : 'en-US';
};

// ─── Voice assignment ────────────────────────────────────────────────────────

const getVoiceForPlayer = (playerId: string, lang: string): VoiceLike | null => {
  const synth = getSynth();
  if (!synth) return null;
  let all: VoiceLike[] = [];
  try {
    all = synth.getVoices() ?? [];
  } catch {
    return null;
  }
  const sameLang = sameLanguageVoices(all, lang);
  const candidates = sameLang.length > 0 ? sameLang : all;
  if (candidates.length === 0) return null; // browser default via utterance.lang

  const cacheKey = `${playerId}:${lang}`;
  const cached = voiceCache.get(cacheKey);
  if (cached && candidates.includes(cached)) return cached;

  const voice = candidates[pickVoiceIndex(playerId, candidates.length)];
  voiceCache.set(cacheKey, voice);
  return voice;
};

// ─── Cancel ──────────────────────────────────────────────────────────────────

const cancelCurrent = (): void => {
  const synth = getSynth();
  try {
    synth?.cancel();
  } catch {
    // Cancelling is best-effort — never throw into game code.
  }
  const finish = current?.finish;
  current = null;
  if (finish) finish(); // settle the pending enqueue promise immediately
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Speak `text` for a player. Resolves when the utterance ends, errors, is
 * cancelled, or hits the hard max duration — never rejects, never blocks the
 * game. No-ops (resolved promise) when: the log id was already spoken, TTS is
 * disabled or muted, the text is empty, or the API is absent.
 */
export const enqueue = (
  text: string,
  lang: string,
  speakerPlayerId: number | string,
  speechLogId: string,
): Promise<void> => {
  if (speechLogId && spokenIds.has(speechLogId)) return Promise.resolve();

  const synth = getSynth();
  const Utterance = getUtteranceCtor();
  if (!synth || !Utterance || !prefs.enabled || prefs.muted || !text.trim()) {
    return Promise.resolve();
  }

  ensureVoicesInit();
  cancelCurrent(); // max one active utterance — new speech replaces current

  // Play-once: committed here so rerenders/cancels never replay this log.
  if (speechLogId) spokenIds.add(speechLogId);

  return new Promise<void>(resolve => {
    let utterance: UtteranceLike;
    try {
      utterance = new Utterance(text);
    } catch {
      resolve();
      return;
    }
    utterance.lang = lang;
    utterance.volume = prefs.volume;
    utterance.rate = prefs.rate;
    const voice = getVoiceForPlayer(String(speakerPlayerId), lang);
    if (voice) utterance.voice = voice;

    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      utterance.onend = null;
      utterance.onerror = null;
      if (current?.utterance === utterance) current = null;
      resolve();
    };
    const timeoutId = setTimeout(finish, speechMaxDurationMs(text));
    utterance.onend = finish;
    utterance.onerror = finish;
    current = { utterance, finish };
    try {
      synth.speak(utterance);
    } catch {
      finish(); // a throwing backend must never stall the AI turn
    }
  });
};

/** Cancel the current speech immediately. Safe to call unconditionally. */
export const cancel = (): void => {
  cancelCurrent();
};

/** Master volume (0–1, clamped). Applies to subsequent utterances. */
export const setVolume = (v: number): void => {
  prefs.volume = Math.max(0, Math.min(1, v));
};

/** Speech rate (0.5–2, clamped). Applies to subsequent utterances. */
export const setRate = (r: number): void => {
  prefs.rate = Math.max(0.5, Math.min(2, r));
};

/**
 * AI-voice master switch. Turning it on happens only from a user click
 * (autoplay-policy gesture); turning it off cancels the current speech.
 */
export const setEnabled = (b: boolean): void => {
  prefs.enabled = b;
  if (!b) cancelCurrent();
};

/** Mute/unmute. Muting cancels the current speech immediately. */
export const setMuted = (b: boolean): void => {
  prefs.muted = b;
  if (b) cancelCurrent();
};

/** True while an utterance is active. */
export const isSpeaking = (): boolean => current !== null;

/** True when a speechSynthesis backend is available. */
export const isSupported = (): boolean => getSynth() !== null;

/** New game/restart: cancel audio and clear the play-once dedupe set. */
export const reset = (): void => {
  cancelCurrent();
  spokenIds.clear();
  voiceCache.clear();
};

// ─── Vote-countdown tick (WebAudio oscillator blip, no file) ─────────────────

let tickContext: AudioContext | null = null;

/**
 * One short beep — called once per second during the last 3 seconds of the
 * vote countdown. Obeys mute + volume. Autoplay-safe: an AudioContext created
 * without a user gesture stays suspended and produces no sound (no bypass);
 * by countdown time the user has interacted, so resume succeeds.
 */
export const playTick = (): void => {
  if (prefs.muted || prefs.volume <= 0) return;
  if (typeof window === 'undefined') return;
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    if (!tickContext) tickContext = new Ctor();
    if (tickContext.state === 'suspended') {
      void tickContext.resume().catch(() => undefined);
    }
    const now = tickContext.currentTime;
    const osc = tickContext.createOscillator();
    const gain = tickContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.08 * prefs.volume, now);
    gain.gain.linearRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain).connect(tickContext.destination);
    osc.start(now);
    osc.stop(now + 0.12);
  } catch {
    // The tick is optional polish — a failing AudioContext never throws.
  }
};

// ─── Module init ─────────────────────────────────────────────────────────────

// Kick Chrome's async voice load as early as possible (no-op elsewhere).
ensureVoicesInit();

// ─── Test hooks ──────────────────────────────────────────────────────────────

export const __test = {
  /** Inject a speechSynthesis-like backend + utterance constructor. */
  inject(synth: SynthLike | null, ctor: UtteranceCtor | null): void {
    injectedSynth = synth;
    injectedCtor = ctor;
    voicesInitDone = false;
    voiceCache.clear();
  },
  /** Full state reset between tests (settles any pending enqueue). */
  resetAll(): void {
    cancelCurrent();
    spokenIds.clear();
    voiceCache.clear();
    injectedSynth = undefined;
    injectedCtor = undefined;
    voicesInitDone = false;
    prefs.muted = false;
    prefs.volume = 1;
    prefs.rate = 1;
    prefs.enabled = false;
  },
  getSpokenIds: (): ReadonlySet<string> => spokenIds,
};
