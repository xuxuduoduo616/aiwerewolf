/**
 * V-C contract tests: the push-to-talk controller is driven through the real
 * `createSttAdapter` / `createCloudTranscribe` seam, with `fetch` mocked. No
 * real network, no `QWEN_API_KEY` and no real microphone are involved.
 *
 * The seven paths required by the card are numbered 1/7 … 7/7 so the report
 * can reference them directly. The existing `sttAdapter.test.ts` covers the
 * transport unit matrix (429/502/503/unreadable payload) and
 * `SpeechInput.test.ts` covers the controller with an injected fake
 * transcriber; this file covers the seam between the two at the contract
 * level: the observable input value, button/status state, one-shot write and
 * MediaStream track release.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RECORDING_MS,
  STT_ENDPOINT,
  createCloudTranscribe,
  createSttAdapter,
  type SttLanguage,
} from './sttAdapter';
import SpeechInput, {
  VOICE_MESSAGES,
  createVoiceInputController,
  type VoiceEnvironment,
  type VoiceRecorderLike,
} from '../components/SpeechInput';

const ok = (payload: unknown) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

const makeRecorder = (
  chunks: Blob[] = [new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/webm' })],
) => {
  const recorder: VoiceRecorderLike & {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  } = {
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

interface VoiceState {
  status: string;
  message: string | null;
}

const makeHarness = (overrides: {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  environment?: VoiceEnvironment;
  existingInput?: string;
} = {}) => {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const recorder = makeRecorder();
  const environment: VoiceEnvironment = overrides.environment ?? {
    getUserMedia: vi.fn().mockResolvedValue(stream),
    createRecorder: vi.fn().mockReturnValue(recorder),
  };
  const fetchMock = vi.fn(overrides.fetchImpl ?? (async () => ok({ text: 'I trust Player 4.' })));
  const states: VoiceState[] = [];
  const writes: string[] = [];
  let input = overrides.existingInput ?? '';

  const controller = createVoiceInputController({
    lang: 'en-US',
    environment,
    prepareAudio: async audio => audio,
    createAdapter: (lang: SttLanguage) => createSttAdapter({
      lang,
      // Real same-origin transport; only the network layer is mocked.
      transcribe: createCloudTranscribe({ fetchImpl: fetchMock as unknown as typeof fetch }),
    }),
    callbacks: {
      onState: (status, message) => states.push({ status, message }),
      onTranscript: text => {
        input = text;
        writes.push(text);
      },
    },
  });

  return {
    controller,
    environment,
    recorder,
    track,
    fetchMock,
    states,
    writes,
    input: () => input,
  };
};

const lastState = (states: VoiceState[]): VoiceState | undefined => states[states.length - 1];

const settle = async (rounds = 24) => {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('speech input contract (real adapter seam, mocked same-origin fetch)', () => {
  it('1/7 stays local while held and only enters transcribing after release', async () => {
    const harness = makeHarness();

    await harness.controller.start();
    expect(harness.controller.getStatus()).toBe('recording');
    expect(harness.fetchMock, 'no upload/interim while the button is held').not.toHaveBeenCalled();
    expect(harness.writes).toEqual([]);

    harness.controller.stop();
    expect(harness.controller.getStatus()).toBe('transcribing');
    expect(lastState(harness.states)).toEqual({ status: 'transcribing', message: null });

    await vi.waitFor(() => expect(harness.fetchMock).toHaveBeenCalledTimes(1));
    expect(harness.fetchMock.mock.calls[0][0]).toBe(STT_ENDPOINT);
    await vi.waitFor(() => expect(harness.writes).toEqual(['I trust Player 4.']));
    expect(harness.controller.getStatus()).toBe('idle');
    expect(harness.track.stop).toHaveBeenCalled();
  });

  it('2/7 writes the trimmed same-origin mock response exactly once', async () => {
    const harness = makeHarness({
      fetchImpl: async () => ok({ text: '  I trust Player 4.  ' }),
    });

    await harness.controller.start();
    harness.controller.stop();
    await vi.waitFor(() => expect(harness.writes).toEqual(['I trust Player 4.']));
    await settle();

    expect(harness.writes).toHaveLength(1);
    expect(harness.input()).toBe('I trust Player 4.');
    expect(harness.controller.getStatus()).toBe('idle');
    expect(lastState(harness.states)).toEqual({ status: 'idle', message: null });
    expect(harness.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);

    const init = harness.fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as {
      audio: string;
      lang: string;
      durationMs: number;
    };
    expect(Object.keys(body).sort()).toEqual(['audio', 'durationMs', 'lang']);
    expect(body.lang).toBe('en-US');
    expect(body.audio).toMatch(/^data:audio\/webm;base64,[A-Za-z0-9+/=]+$/);
    expect(body.durationMs).toBeGreaterThanOrEqual(0);
    expect(body.durationMs).toBeLessThanOrEqual(MAX_RECORDING_MS);
  });

  it('3/7 keeps the typed draft and reports No speech detected for an empty result', async () => {
    const harness = makeHarness({
      existingInput: 'typed draft',
      fetchImpl: async () => ok({ text: '   ' }),
    });

    await harness.controller.start();
    harness.controller.stop();
    await vi.waitFor(() => expect(lastState(harness.states)).toEqual({
      status: 'idle',
      message: VOICE_MESSAGES.noSpeech,
    }));

    expect(harness.writes).toEqual([]);
    expect(harness.input()).toBe('typed draft');
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    expect(harness.track.stop).toHaveBeenCalledTimes(1);
  });

  it('4/7 maps permission denial and unsupported browsers to a silent no-op', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const deniedHarness = makeHarness({
      environment: {
        getUserMedia: vi.fn().mockRejectedValue(denied),
        createRecorder: vi.fn(),
      },
    });

    await deniedHarness.controller.start();
    expect(deniedHarness.controller.getStatus()).toBe('idle');
    expect(lastState(deniedHarness.states)).toEqual({
      status: 'idle',
      message: VOICE_MESSAGES.permissionDenied,
    });
    expect(deniedHarness.fetchMock).not.toHaveBeenCalled();
    expect(deniedHarness.writes).toEqual([]);

    const unsupportedHarness = makeHarness({ environment: {} });
    expect(unsupportedHarness.controller.isSupported()).toBe(false);
    await unsupportedHarness.controller.start();
    expect(unsupportedHarness.controller.getStatus()).toBe('idle');
    expect(unsupportedHarness.states).toEqual([]);
    expect(unsupportedHarness.fetchMock).not.toHaveBeenCalled();
    expect(unsupportedHarness.writes).toEqual([]);
  });

  it('5/7 aborts at the 15s client budget and shows the timeout line', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const harness = makeHarness({
      fetchImpl: (_url, init) => new Promise<Response>((_resolve, reject) => {
        if (init?.signal) signals.push(init.signal);
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    });

    await harness.controller.start();
    harness.controller.stop();
    expect(harness.controller.getStatus()).toBe('transcribing');

    // Flush the microtasks that build the WAV/data URL and reach fetch.
    await settle();
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    expect(signals[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(15_000);
    await settle();

    expect(signals[0]?.aborted).toBe(true);
    expect(harness.controller.getStatus()).toBe('idle');
    expect(lastState(harness.states)).toEqual({
      status: 'idle',
      message: VOICE_MESSAGES.transcriptionTimeout,
    });
    expect(harness.writes).toEqual([]);
    expect(harness.track.stop).toHaveBeenCalled();
  });

  it('6/7 cancellation aborts the in-flight request and drops its late text', async () => {
    const signals: AbortSignal[] = [];
    let resolveLate: (response: Response) => void = () => undefined;
    const harness = makeHarness({
      existingInput: 'typed draft',
      fetchImpl: (_url, init) => new Promise<Response>(resolve => {
        if (init?.signal) signals.push(init.signal);
        resolveLate = resolve;
      }),
    });

    await harness.controller.start();
    harness.controller.stop();
    await vi.waitFor(() => expect(harness.fetchMock).toHaveBeenCalledTimes(1));
    expect(harness.controller.getStatus()).toBe('transcribing');

    harness.controller.cancel();
    expect(signals[0]?.aborted).toBe(true);
    expect(harness.controller.getStatus()).toBe('idle');
    expect(lastState(harness.states)).toEqual({ status: 'idle', message: null });

    resolveLate?.(ok({ text: 'late result' }));
    await settle();

    expect(harness.writes).toEqual([]);
    expect(harness.input()).toBe('typed draft');
    expect(harness.track.stop).toHaveBeenCalled();
  });

  it('7/7 stops at 60s, transcribes the captured audio once and never reopens the mic', async () => {
    vi.useFakeTimers();
    const harness = makeHarness();

    await harness.controller.start();
    expect(harness.controller.getStatus()).toBe('recording');

    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS);
    await settle();

    expect(harness.recorder.stop).toHaveBeenCalledTimes(1);
    expect(harness.environment.getUserMedia).toHaveBeenCalledTimes(1);
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    const init = harness.fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body)) as { durationMs: number };
    expect(body.durationMs).toBe(MAX_RECORDING_MS);
    expect(harness.writes).toEqual(['I trust Player 4.']);
    expect(harness.controller.getStatus()).toBe('idle');
    expect(harness.track.stop).toHaveBeenCalled();
  });
});

describe('voice input only on the human turn', () => {
  it('renders no microphone outside the turn and suspends an active recording', async () => {
    const hidden = renderToStaticMarkup(React.createElement(SpeechInput, {
      value: '',
      onChange: () => undefined,
      onSubmit: () => undefined,
      visible: false,
      selectedPlayer: null,
    }));
    expect(hidden).toBe('');
    expect(hidden).not.toContain('data-voice-control');

    const harness = makeHarness();
    await harness.controller.start();
    expect(harness.controller.getStatus()).toBe('recording');

    // This is exactly what SpeechInput's `visible === false` effect calls.
    harness.controller.suspend();
    await settle();

    expect(harness.controller.getStatus()).toBe('idle');
    expect(harness.track.stop).toHaveBeenCalled();
    expect(harness.recorder.stop, 'the recorder is released without submitting').toHaveBeenCalledTimes(1);
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(harness.writes).toEqual([]);
  });
});
