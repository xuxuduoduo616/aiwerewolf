import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, it, expect, vi } from 'vitest';
import SpeechInput, {
  speechPlaceholder,
  VoiceControl,
  VOICE_MESSAGES,
  createVoiceInputController,
  encodePcm16Wav,
  voiceInputSupported,
  type VoiceControllerOptions,
  type VoiceEnvironment,
  type VoiceRecorderLike,
} from './SpeechInput';
import { MAX_RECORDING_MS, SttError } from '../services/sttAdapter';

const responsiveCss = readFileSync(new URL('../styles/game-responsive.css', import.meta.url), 'utf8');

const settle = async (rounds = 8) => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

const makeStream = () => {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] }, track };
};

const makeRecorder = (
  chunks: Blob[] = [new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' })],
) => {
  const recorder: VoiceRecorderLike & { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> } = {
    mimeType: 'audio/webm',
    state: 'inactive',
    ondataavailable: null,
    onstop: null,
    onerror: null,
    start: vi.fn(function start(this: VoiceRecorderLike) {
      this.state = 'recording';
    }),
    stop: vi.fn(function stop(this: VoiceRecorderLike) {
      this.state = 'inactive';
      for (const chunk of chunks) this.ondataavailable?.({ data: chunk });
      this.onstop?.();
    }),
  };
  return recorder;
};

const makeHarness = (overrides: {
  environment?: VoiceEnvironment;
  transcribe?: ReturnType<typeof vi.fn>;
} = {}) => {
  const { stream, track } = makeStream();
  const recorder = makeRecorder();
  const environment: VoiceEnvironment = overrides.environment ?? {
    getUserMedia: vi.fn().mockResolvedValue(stream),
    createRecorder: vi.fn().mockReturnValue(recorder),
  };
  const transcribe = overrides.transcribe ?? vi.fn().mockResolvedValue({ text: '  hello there  ' });
  const states: Array<{ status: string; message: string | null }> = [];
  const transcripts: string[] = [];
  const adapterLanguages: string[] = [];
  const options: VoiceControllerOptions = {
    lang: 'en-US',
    environment,
    prepareAudio: async audio => audio,
    createAdapter: lang => {
      adapterLanguages.push(lang);
      return { transcribe };
    },
    callbacks: {
      onState: (status, message) => states.push({ status, message }),
      onTranscript: text => transcripts.push(text),
    },
  };
  const controller = createVoiceInputController(options);
  return { controller, environment, recorder, track, stream, transcribe, states, transcripts, adapterLanguages };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('speechPlaceholder', () => {
  it('keeps interface copy English when stored speech language is zh', () => {
    expect(speechPlaceholder('zh')).toBe('Your turn to speak...');
  });

  it('returns the English placeholder in en mode', () => {
    expect(speechPlaceholder('en')).toBe('Your turn to speak...');
  });
});

describe('SpeechInput layout', () => {
  it('allows the input row to wrap and shrink at effective 200% zoom', () => {
    const html = renderToStaticMarkup(React.createElement(SpeechInput, {
      value: 'User-authored speech',
      onChange: () => undefined,
      onSubmit: () => undefined,
      visible: true,
      selectedPlayer: null,
    }));

    expect(html).toContain('class="flex w-full min-w-0 flex-wrap gap-2"');
    expect(html).toContain('class="min-w-0 flex-[1_1_8rem]');
    expect(html).toContain('class="action-button shrink-0 px-3"');
    expect(html).toContain('aria-label="Send speech"');
  });

  it('gives every quick-speech preset a wrapping 44px target', () => {
    const html = renderToStaticMarkup(React.createElement(SpeechInput, {
      value: '',
      onChange: () => undefined,
      onSubmit: () => undefined,
      visible: true,
      selectedPlayer: null,
    }));

    expect(html).toContain('class="game-speech-input mt-4 flex flex-col gap-2"');
    expect(html).toContain('class="game-speech-presets flex flex-wrap gap-1.5"');
    expect(html.match(/game-quick-speech-button/g)).toHaveLength(7);
    expect(responsiveCss).toMatch(/\.game-quick-speech-button\s*\{[\s\S]*?min-height:\s*44px;[\s\S]*?white-space:\s*normal;/);
    expect(responsiveCss).toMatch(/@media \(min-width: 1024px\)\s*\{[\s\S]*?\.game-room \.game-speech-presets\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);[\s\S]*?row-gap:\s*4px;/);
    expect(responsiveCss).toMatch(/\.game-room \.game-speech-input\s*\{[\s\S]*?margin-top:\s*12px;/);
  });

  it('renders nothing outside the human turn, so no hidden recording entry exists', () => {
    const html = renderToStaticMarkup(React.createElement(SpeechInput, {
      value: 'x',
      onChange: () => undefined,
      onSubmit: () => undefined,
      visible: false,
      selectedPlayer: null,
    }));

    expect(html).toBe('');
  });

  it('keeps the typed fallback working when the browser cannot record', () => {
    const html = renderToStaticMarkup(React.createElement(SpeechInput, {
      value: '',
      onChange: () => undefined,
      onSubmit: () => undefined,
      visible: true,
      selectedPlayer: null,
    }));

    expect(html).toContain('aria-label="Send speech"');
    expect(html).toContain(VOICE_MESSAGES.unsupported);
  });
});

describe('VoiceControl presentation', () => {
  const render = (props: Partial<React.ComponentProps<typeof VoiceControl>> = {}) =>
    renderToStaticMarkup(React.createElement(VoiceControl, {
      supported: true,
      status: 'idle',
      message: null,
      ...props,
    }));

  it('renders an enabled push-to-talk button while idle', () => {
    const html = render();
    expect(html).toContain('aria-label="Hold to record speech"');
    expect(html).toContain('data-voice-control');
    expect(html).not.toContain('disabled');
  });

  it('shows Recording… and offers cancellation while recording', () => {
    const html = render({ status: 'recording' });
    expect(html).toContain(VOICE_MESSAGES.recording);
    expect(html).toContain('aria-label="Cancel voice input"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('shows Transcribing… and disables new recordings', () => {
    const html = render({ status: 'transcribing' });
    expect(html).toContain('Transcribing…');
    expect(html).toContain('disabled');
  });

  it('disables the button and explains unsupported browsers', () => {
    const html = render({ supported: false });
    expect(html).toContain('disabled');
    expect(html).toContain(VOICE_MESSAGES.unsupported);
  });

  it('renders each visible degradation message', () => {
    for (const message of [
      VOICE_MESSAGES.permissionDenied,
      VOICE_MESSAGES.noSpeech,
      VOICE_MESSAGES.transcriptionTimeout,
      VOICE_MESSAGES.unavailable,
    ]) {
      expect(render({ message })).toContain(message);
    }
  });

  it('exposes the voice status for browser smoke tests', () => {
    expect(render({ status: 'transcribing' })).toContain('data-voice-status="transcribing"');
  });
});

describe('voiceInputSupported', () => {
  it('requires both getUserMedia and MediaRecorder', () => {
    expect(voiceInputSupported({})).toBe(false);
    expect(voiceInputSupported({ getUserMedia: vi.fn() })).toBe(false);
    expect(voiceInputSupported({ getUserMedia: vi.fn(), createRecorder: vi.fn() })).toBe(true);
    expect(voiceInputSupported()).toBe(false);
  });
});

describe('VoiceInputController', () => {
  it('records, stops tracks and writes the final transcript once', async () => {
    const harness = makeHarness();
    harness.transcribe.mockResolvedValue({ text: '  I trust Player 4.  ' });

    await harness.controller.start();
    expect(harness.controller.getStatus()).toBe('recording');
    expect(harness.recorder.start).toHaveBeenCalledTimes(1);
    expect(harness.environment.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: expect.any(Object) }));

    harness.controller.stop();
    await settle();

    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    const [audio, options] = harness.transcribe.mock.calls[0];
    expect(audio).toBeInstanceOf(Blob);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.durationMs).toBeGreaterThanOrEqual(0);
    expect(harness.transcripts).toEqual(['I trust Player 4.']);
    expect(harness.states[harness.states.length - 1]).toEqual({ status: 'idle', message: null });
    expect(harness.controller.getStatus()).toBe('idle');
  });

  it('replaces the input text only after the user releases, never on press', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    expect(harness.transcripts).toEqual([]);
    expect(harness.transcribe).not.toHaveBeenCalled();

    harness.controller.stop();
    await settle();
    expect(harness.transcripts).toEqual(['hello there']);
  });

  it('cancels a recording, discards audio and never transcribes', async () => {
    const harness = makeHarness();
    await harness.controller.start();

    harness.controller.cancel();
    await settle();

    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.transcribe).not.toHaveBeenCalled();
    expect(harness.transcripts).toEqual([]);
    expect(harness.states[harness.states.length - 1]).toEqual({ status: 'idle', message: null });
  });

  it('stops on a second press while recording instead of starting twice', async () => {
    const harness = makeHarness();
    await harness.controller.start();
    await harness.controller.start();

    expect(harness.environment.getUserMedia).toHaveBeenCalledTimes(1);

    harness.controller.cancel();
    expect(harness.track.stop).toHaveBeenCalledTimes(1);
  });

  it('auto-stops at the 60s limit and still transcribes what was recorded', async () => {
    vi.useFakeTimers();
    const harness = makeHarness();
    await harness.controller.start();

    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS);
    await settle();

    expect(harness.recorder.stop).toHaveBeenCalledTimes(1);
    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.transcribe).toHaveBeenCalledTimes(1);
    expect(harness.transcribe.mock.calls[0][1].durationMs).toBeLessThanOrEqual(MAX_RECORDING_MS);
    expect(harness.transcripts).toEqual(['hello there']);
  });

  it('drops in-flight work and audio when the turn is lost', async () => {
    const deferred: { resolve?: (result: { text: string }) => void } = {};
    let requestSignal: AbortSignal | null = null;
    const transcribe = vi.fn((_audio: Blob, options: { signal: AbortSignal }) => new Promise<{ text: string }>(resolve => {
      requestSignal = options.signal;
      deferred.resolve = resolve;
    }));
    const harness = makeHarness({ transcribe });

    await harness.controller.start();
    harness.controller.stop();
    await settle();
    expect(harness.controller.getStatus()).toBe('transcribing');
    expect(requestSignal).not.toBeNull();

    harness.controller.suspend();
    expect((requestSignal as unknown as AbortSignal).aborted).toBe(true);
    expect(harness.track.stop).toHaveBeenCalledTimes(1);

    deferred.resolve?.({ text: 'late result' });
    await settle();

    expect(harness.transcripts).toEqual([]);
    expect(harness.states[harness.states.length - 1]).toEqual({ status: 'idle', message: null });
    expect(harness.controller.getStatus()).toBe('idle');
  });

  it('maps permission denial to one visible line without throwing', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const environment: VoiceEnvironment = {
      getUserMedia: vi.fn().mockRejectedValue(denied),
      createRecorder: vi.fn(),
    };
    const harness = makeHarness({ environment });

    await expect(harness.controller.start()).resolves.toBeUndefined();

    expect(harness.controller.getStatus()).toBe('idle');
    expect(harness.states[harness.states.length - 1]).toEqual({ status: 'idle', message: VOICE_MESSAGES.permissionDenied });
    expect(harness.transcribe).not.toHaveBeenCalled();
  });

  it('treats unsupported browsers as a no-op and never requests the microphone', async () => {
    const harness = makeHarness({ environment: {} });
    expect(harness.controller.isSupported()).toBe(false);

    await harness.controller.start();

    expect(harness.states).toEqual([]);
    expect(harness.controller.getStatus()).toBe('idle');
  });

  it('does not write an empty result into the input and reports No speech detected', async () => {
    const harness = makeHarness();
    harness.transcribe.mockResolvedValue({ text: '   ' });

    await harness.controller.start();
    harness.controller.stop();
    await settle();

    expect(harness.transcripts).toEqual([]);
    expect(harness.states[harness.states.length - 1]).toEqual({ status: 'idle', message: VOICE_MESSAGES.noSpeech });
  });

  it.each([
    [new SttError('timeout'), VOICE_MESSAGES.transcriptionTimeout],
    [new SttError('unavailable'), VOICE_MESSAGES.unavailable],
  ])('maps %s to one visible line', async (error, message) => {
    const harness = makeHarness();
    harness.transcribe.mockRejectedValue(error);

    await harness.controller.start();
    harness.controller.stop();
    await settle();

    expect(harness.transcripts).toEqual([]);
    expect(harness.states[harness.states.length - 1]).toEqual({ status: 'idle', message });
  });

  it('survives the StrictMode setup → cleanup → setup cycle and records again', async () => {
    const harness = makeHarness();
    await harness.controller.start();

    // React.StrictMode runs the effect cleanup once on mount; that cleanup must
    // suspend the active session instead of permanently disposing the controller.
    harness.controller.suspend();

    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.controller.getStatus()).toBe('idle');

    // Setup runs again with the same controller and must still be able to record.
    await harness.controller.start();
    expect(harness.controller.getStatus()).toBe('recording');

    harness.controller.stop();
    await settle();

    expect(harness.transcripts).toEqual(['hello there']);
    expect(harness.states[harness.states.length - 1]).toEqual({ status: 'idle', message: null });
  });

  it('stops every MediaStream track on an explicit hard dispose', async () => {
    const harness = makeHarness();
    await harness.controller.start();

    harness.controller.dispose();

    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.controller.getStatus()).toBe('idle');
    expect(harness.states).toEqual([{ status: 'recording', message: null }]);
  });

  it('applies a language change to the next recording without a reload', async () => {
    const harness = makeHarness();
    harness.controller.setLanguage('zh-CN');

    await harness.controller.start();
    harness.controller.stop();
    await settle();

    expect(harness.adapterLanguages).toEqual(['zh-CN']);
  });
});

describe('encodePcm16Wav', () => {
  it('writes a mono 16-bit RIFF/WAVE header and PCM samples', () => {
    const bytes = encodePcm16Wav(new Float32Array([0, 1, -1]), 16000);
    const view = new DataView(bytes);
    const ascii = (start: number, end: number) => String.fromCharCode(
      ...new Uint8Array(bytes, start, end - start),
    );

    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 12)).toBe('WAVE');
    expect(ascii(12, 16)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(6);
    expect(bytes.byteLength).toBe(44 + 6);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
  });
});
