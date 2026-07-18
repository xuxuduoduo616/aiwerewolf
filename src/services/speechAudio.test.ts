/**
 * speechAudio tests (card: browser-tts-mvp).
 *
 * Mocks the ENTIRE speechSynthesis-like backend (speak, cancel, getVoices,
 * addEventListener) plus the utterance constructor, injected via
 * `__test.inject` (repo convention: no jsdom — node environment). The real
 * service logic is exercised, never mocked.
 *
 * Covers: play, queueing order, per-log-ID dedupe, cancel (explicit / mute /
 * disable / new-speech), language selection, voice assignment stability,
 * voice-change recalculation (incl. empty list then voiceschanged),
 * speak-timeout fallback, and API-absent graceful no-op.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancel,
  enqueue,
  hashPlayerId,
  isSpeaking,
  isSupported,
  pickVoiceIndex,
  playTick,
  reset,
  sameLanguageVoices,
  setEnabled,
  setMuted,
  setRate,
  setVolume,
  speechLangTag,
  speechMaxDurationMs,
  __test,
  type SynthLike,
  type UtteranceLike,
  type VoiceLike,
} from './speechAudio';

// ─── Mock backend ────────────────────────────────────────────────────────────

const makeVoice = (name: string, lang: string): VoiceLike => ({
  name,
  lang,
  voiceURI: `${name}:${lang}`,
  default: false,
});

const ZH_VOICES = [makeVoice('Tingting', 'zh-CN'), makeVoice('Meijia', 'zh-TW')];
const EN_VOICES = [makeVoice('Samantha', 'en-US'), makeVoice('Daniel', 'en-GB')];
const DEFAULT_VOICES: VoiceLike[] = [...ZH_VOICES, ...EN_VOICES];

/** Utterances constructed during the current test, in creation order. */
let utterances: MockUtterance[] = [];

class MockUtterance implements UtteranceLike {
  text: string;
  lang = '';
  volume = 1;
  rate = 1;
  voice: VoiceLike | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
    utterances.push(this);
  }
}

interface MockSynth extends SynthLike {
  voices: VoiceLike[];
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
}

const makeSynth = (voices: VoiceLike[] = DEFAULT_VOICES): MockSynth => {
  const synth = {
    voices: [...voices],
    speak: vi.fn(),
    cancel: vi.fn(),
    getVoices: vi.fn((): VoiceLike[] => synth.voices),
    addEventListener: vi.fn(),
  };
  return synth;
};

/** The listener the service registered for voiceschanged (if any). */
const voicesChangedListener = (synth: MockSynth): (() => void) | undefined =>
  synth.addEventListener.mock.calls.find(call => call[0] === 'voiceschanged')?.[1];

let synth: MockSynth;

const install = (voices?: VoiceLike[]): void => {
  synth = makeSynth(voices);
  utterances = [];
  __test.inject(synth, MockUtterance as unknown as new (text: string) => UtteranceLike);
};

beforeEach(() => {
  __test.resetAll();
  install();
  setEnabled(true); // simulate the user-gesture toggle so speech can play
});

afterEach(() => {
  __test.resetAll();
  vi.useRealTimers();
});

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe('pure decision helpers', () => {
  it('hashPlayerId is deterministic and non-negative', () => {
    expect(hashPlayerId('7')).toBe(hashPlayerId('7'));
    expect(hashPlayerId('12')).toBeGreaterThanOrEqual(0);
    expect(hashPlayerId('')).toBe(0);
  });

  it('pickVoiceIndex maps stably into range and handles empty lists', () => {
    for (const id of ['1', '2', '3', '12']) {
      const index = pickVoiceIndex(id, 4);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(4);
      expect(index).toBe(pickVoiceIndex(id, 4));
    }
    expect(pickVoiceIndex('1', 0)).toBe(-1);
  });

  it('sameLanguageVoices matches by primary subtag', () => {
    expect(sameLanguageVoices(DEFAULT_VOICES, 'zh-CN')).toEqual(ZH_VOICES);
    expect(sameLanguageVoices(DEFAULT_VOICES, 'en-US')).toEqual(EN_VOICES);
    expect(sameLanguageVoices(DEFAULT_VOICES, 'fr-FR')).toEqual([]);
  });

  it('speechMaxDurationMs has a 5s floor and grows with text length', () => {
    expect(speechMaxDurationMs('hi')).toBe(5000);
    expect(speechMaxDurationMs('x'.repeat(200))).toBe(6000);
  });

  it('speechLangTag detects the text language, falling back to the game language', () => {
    expect(speechLangTag('我怀疑3号，今天先投他。', 'en')).toBe('zh-CN');
    expect(speechLangTag('I think Player 3 is lying.', 'zh')).toBe('en-US');
    expect(speechLangTag('……', 'zh')).toBe('zh-CN');
    expect(speechLangTag('……', 'en')).toBe('en-US');
  });
});

// ─── Support / gating ────────────────────────────────────────────────────────

describe('isSupported', () => {
  it('is true with an injected backend, false without', () => {
    expect(isSupported()).toBe(true);
    __test.inject(null, null);
    expect(isSupported()).toBe(false);
  });
});

describe('gating — enabled / muted', () => {
  it('does not speak while disabled (default state: gesture not yet given)', async () => {
    setEnabled(false);
    await enqueue('hello', 'en-US', 1, 'log-a');
    expect(synth.speak).not.toHaveBeenCalled();
    // A gated log is NOT marked spoken — it can play later once enabled.
    expect(__test.getSpokenIds().has('log-a')).toBe(false);
  });

  it('does not speak while muted', async () => {
    setMuted(true);
    await enqueue('hello', 'en-US', 1, 'log-b');
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('speaks after enabling and unmuting', () => {
    setMuted(true);
    setMuted(false);
    void enqueue('hello', 'en-US', 1, 'log-c');
    expect(synth.speak).toHaveBeenCalledTimes(1);
    utterances[0].onend?.();
  });

  it('ignores empty/whitespace text', async () => {
    await enqueue('   ', 'en-US', 1, 'log-d');
    expect(synth.speak).not.toHaveBeenCalled();
  });
});

// ─── Play ────────────────────────────────────────────────────────────────────

describe('enqueue — play', () => {
  it('speaks with the requested text, lang, volume, and rate', async () => {
    setVolume(0.6);
    setRate(1.4);
    const promise = enqueue('I suspect Player 3.', 'en-US', 2, 'log-play');
    expect(synth.speak).toHaveBeenCalledTimes(1);
    const utterance = utterances[0];
    expect(utterance.text).toBe('I suspect Player 3.');
    expect(utterance.lang).toBe('en-US');
    expect(utterance.volume).toBe(0.6);
    expect(utterance.rate).toBe(1.4);
    utterance.onend?.();
    await promise;
    expect(isSpeaking()).toBe(false);
  });

  it('resolves on utterance error without throwing', async () => {
    const promise = enqueue('hello', 'en-US', 1, 'log-err');
    utterances[0].onerror?.();
    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves even when the backend speak() throws', async () => {
    synth.speak.mockImplementation(() => {
      throw new Error('backend broken');
    });
    await expect(enqueue('hello', 'en-US', 1, 'log-throw')).resolves.toBeUndefined();
    expect(isSpeaking()).toBe(false);
  });
});

// ─── Language selection & voice assignment ───────────────────────────────────

describe('voice assignment', () => {
  it('assigns a same-language voice for the utterance lang', async () => {
    const zh = enqueue('大家好。', 'zh-CN', 3, 'log-zh');
    expect(utterances[0].voice?.lang.startsWith('zh')).toBe(true);
    utterances[0].onend?.();
    await zh;

    const en = enqueue('Hello everyone.', 'en-US', 3, 'log-en');
    expect(utterances[1].voice?.lang.startsWith('en')).toBe(true);
    utterances[1].onend?.();
    await en;
  });

  it('is stable per playerId across utterances', async () => {
    const first = enqueue('speech one', 'zh-CN', 7, 'log-s1');
    utterances[0].onend?.();
    await first;
    const second = enqueue('speech two', 'zh-CN', 7, 'log-s2');
    utterances[1].onend?.();
    await second;
    expect(utterances[0].voice).not.toBeNull();
    expect(utterances[0].voice?.voiceURI).toBe(utterances[1].voice?.voiceURI);
  });

  it('falls back to the full list when no same-language voice exists', () => {
    void enqueue('Bonjour tout le monde, je suspecte le joueur trois.', 'fr-FR', 1, 'log-fr');
    expect(utterances[0].voice).not.toBeNull(); // any-voice fallback
    utterances[0].onend?.();
  });

  it('speaks with no voice (browser lang default) when the list is empty', () => {
    install([]);
    setEnabled(true);
    void enqueue('hello with empty voices', 'en-US', 1, 'log-novoice');
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(utterances[0].voice).toBeNull();
    utterances[0].onend?.();
  });
});

describe('voice-change recalculation', () => {
  it('subscribes to voiceschanged and recomputes after the list changes', async () => {
    const first = enqueue('speech', 'zh-CN', 9, 'log-v1');
    const before = utterances[0].voice;
    expect(before).not.toBeNull();
    utterances[0].onend?.();
    await first;

    // Voice list is replaced (e.g. Chrome finished loading real voices).
    synth.voices = [makeVoice('NewZh', 'zh-CN')];
    const listener = voicesChangedListener(synth);
    expect(listener).toBeDefined();
    listener?.();

    const second = enqueue('speech again', 'zh-CN', 9, 'log-v2');
    expect(utterances[1].voice?.name).toBe('NewZh');
    utterances[1].onend?.();
    await second;
  });

  it('recomputes when the assigned voice disappears even without the event', async () => {
    const first = enqueue('speech', 'zh-CN', 9, 'log-v3');
    utterances[0].onend?.();
    await first;

    synth.voices = [makeVoice('OnlyZh', 'zh-CN')]; // cached voice vanished
    const second = enqueue('speech again', 'zh-CN', 9, 'log-v4');
    expect(utterances[1].voice?.name).toBe('OnlyZh');
    utterances[1].onend?.();
    await second;
  });

  it('starts with an empty list, then picks voices after voiceschanged', async () => {
    install([]);
    setEnabled(true);
    const first = enqueue('early speech', 'zh-CN', 4, 'log-v5');
    expect(utterances[0].voice).toBeNull();
    utterances[0].onend?.();
    await first;

    synth.voices = [...DEFAULT_VOICES]; // async load completed
    voicesChangedListener(synth)?.();

    const second = enqueue('later speech', 'zh-CN', 4, 'log-v6');
    expect(utterances[1].voice?.lang.startsWith('zh')).toBe(true);
    utterances[1].onend?.();
    await second;
  });
});

// ─── Dedupe ──────────────────────────────────────────────────────────────────

describe('per-log-ID dedupe (play-once)', () => {
  it('never speaks the same log id twice', async () => {
    const first = enqueue('once only', 'en-US', 1, 'log-dup');
    utterances[0].onend?.();
    await first;
    await enqueue('once only', 'en-US', 1, 'log-dup');
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it('does not replay a log whose speech was cancelled mid-way', async () => {
    const first = enqueue('cancel me', 'en-US', 1, 'log-cancelled');
    cancel();
    await first;
    await enqueue('cancel me', 'en-US', 1, 'log-cancelled');
    expect(synth.speak).toHaveBeenCalledTimes(1);
  });

  it('speaks distinct log ids', async () => {
    const first = enqueue('first', 'en-US', 1, 'log-x');
    utterances[0].onend?.();
    await first;
    const second = enqueue('second', 'en-US', 2, 'log-y');
    utterances[1].onend?.();
    await second;
    expect(synth.speak).toHaveBeenCalledTimes(2);
  });
});

// ─── Cancel / single active utterance ────────────────────────────────────────

describe('cancel', () => {
  it('cancels the backend and settles the pending promise immediately', async () => {
    const promise = enqueue('long speech', 'en-US', 1, 'log-c1');
    expect(isSpeaking()).toBe(true);
    cancel();
    expect(synth.cancel).toHaveBeenCalled();
    expect(isSpeaking()).toBe(false);
    await expect(promise).resolves.toBeUndefined();
  });

  it('a new enqueue cancels the current utterance (max one speaker)', async () => {
    const first = enqueue('speaker A', 'en-US', 1, 'log-c2');
    const second = enqueue('speaker B', 'en-US', 2, 'log-c3');
    await first; // settled by the replacement, not left hanging
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(2);
    expect(utterances[1].text).toBe('speaker B');
    utterances[1].onend?.();
    await second;
  });

  it('mute-on cancels the current speech immediately', async () => {
    const promise = enqueue('interrupt me', 'en-US', 1, 'log-c4');
    setMuted(true);
    expect(synth.cancel).toHaveBeenCalled();
    expect(isSpeaking()).toBe(false);
    await promise;
  });

  it('disabling the AI voice cancels the current speech', async () => {
    const promise = enqueue('interrupt me', 'en-US', 1, 'log-c5');
    setEnabled(false);
    expect(synth.cancel).toHaveBeenCalled();
    await promise;
  });

  it('reset cancels and clears the dedupe set (new game)', async () => {
    const first = enqueue('game one speech', 'en-US', 1, 'log-c6');
    utterances[0].onend?.();
    await first;
    expect(__test.getSpokenIds().has('log-c6')).toBe(true);
    reset();
    expect(__test.getSpokenIds().size).toBe(0);
    const again = enqueue('game two speech', 'en-US', 1, 'log-c6');
    expect(synth.speak).toHaveBeenCalledTimes(2);
    utterances[1].onend?.();
    await again;
  });
});

// ─── Timeout fallback ────────────────────────────────────────────────────────

describe('speak-timeout fallback', () => {
  it('resolves after the hard max duration when onend never fires', async () => {
    vi.useFakeTimers();
    const text = 'a hanging utterance';
    const promise = enqueue(text, 'en-US', 1, 'log-t1');
    expect(isSpeaking()).toBe(true);
    vi.advanceTimersByTime(speechMaxDurationMs(text) + 1);
    await expect(promise).resolves.toBeUndefined();
    expect(isSpeaking()).toBe(false);
  });

  it('does not double-settle when onend fires after the timeout', async () => {
    vi.useFakeTimers();
    const text = 'late onend';
    const promise = enqueue(text, 'en-US', 1, 'log-t2');
    const utterance = utterances[0];
    vi.advanceTimersByTime(speechMaxDurationMs(text) + 1);
    await promise;
    expect(() => utterance.onend?.()).not.toThrow(); // handler already detached
  });
});

// ─── Volume / rate clamping ──────────────────────────────────────────────────

describe('setVolume / setRate clamping', () => {
  it('clamps volume into 0–1', () => {
    setVolume(1.8);
    void enqueue('loud', 'en-US', 1, 'log-vol1');
    expect(utterances[0].volume).toBe(1);
    utterances[0].onend?.();

    setVolume(-0.3);
    void enqueue('silent', 'en-US', 1, 'log-vol2');
    expect(utterances[1].volume).toBe(0);
    utterances[1].onend?.();
  });

  it('clamps rate into 0.5–2', () => {
    setRate(5);
    void enqueue('fast', 'en-US', 1, 'log-r1');
    expect(utterances[0].rate).toBe(2);
    utterances[0].onend?.();

    setRate(0.1);
    void enqueue('slow', 'en-US', 1, 'log-r2');
    expect(utterances[1].rate).toBe(0.5);
    utterances[1].onend?.();
  });
});

// ─── API-absent graceful no-op ───────────────────────────────────────────────

describe('API absent — every public method is a safe no-op', () => {
  beforeEach(() => {
    __test.inject(null, null);
    setEnabled(true);
  });

  it('enqueue resolves immediately without throwing', async () => {
    await expect(enqueue('hello', 'en-US', 1, 'log-na')).resolves.toBeUndefined();
    // Not marked spoken — nothing was played.
    expect(__test.getSpokenIds().has('log-na')).toBe(false);
  });

  it('cancel / setMuted / setEnabled / setVolume / setRate / reset never throw', () => {
    expect(() => {
      cancel();
      setMuted(true);
      setMuted(false);
      setEnabled(false);
      setEnabled(true);
      setVolume(0.5);
      setRate(1.5);
      reset();
    }).not.toThrow();
  });

  it('isSpeaking is false and playTick is a no-op (no window in node)', () => {
    expect(isSpeaking()).toBe(false);
    expect(() => playTick()).not.toThrow();
  });
});
