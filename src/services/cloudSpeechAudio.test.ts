import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __test, cancel, pause, resume, enqueue, isSpeaking, setEnabled, speechMaxDurationMs } from './speechAudio';

class BrowserUtterance {
  lang = '';
  volume = 1;
  rate = 1;
  voice = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

class AudioPlayer {
  static instances: AudioPlayer[] = [];
  onplaying: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  volume = 0;
  playbackRate = 0;
  pause = vi.fn();
  removeAttribute = vi.fn();
  load = vi.fn();
  play = vi.fn(async () => { this.onplaying?.(); });
  constructor(public url: string) { AudioPlayer.instances.push(this); }
}

const request = vi.fn();
const synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => [] };
const wave = () => new Response('fake audio', { headers: { 'Content-Type': 'audio/wav' } });
const line = 'Why did you vote for Seven?';
const begin = () => enqueue(line, 'en-US', 2, 'turn-2', 'fake-token');

beforeEach(() => {
  __test.resetAll();
  __test.inject(synth, BrowserUtterance);
  vi.clearAllMocks();
  AudioPlayer.instances = [];
  vi.stubGlobal('Audio', AudioPlayer);
  vi.stubGlobal('fetch', request);
  vi.stubEnv('VITE_BAILIAN_TTS_ENABLED', 'true');
  setEnabled(true);
});

afterEach(() => {
  __test.resetAll();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('Cloud speech and the existing speaker queue', () => {
  it('resumes the same cloud audio after pausing without re-fetching', async () => {
    request.mockResolvedValueOnce(wave());
    const done = begin();
    await vi.waitFor(() => expect(AudioPlayer.instances[0]?.play).toHaveBeenCalledTimes(1));
    const player = AudioPlayer.instances[0];
    pause();
    expect(player.pause).toHaveBeenCalledOnce();
    expect(isSpeaking()).toBe(true);
    resume();
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledOnce();
    player.onended?.();
    await done;
  });

  it('does not play a response arriving after Skip speech', async () => {
    let respond!: (value: Response) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
    const done = begin();
    expect(isSpeaking()).toBe(true);
    cancel();
    await done;
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    respond(wave());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(AudioPlayer.instances).toHaveLength(0);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('speaks the unchanged text once via the browser if the cloud fails', async () => {
    request.mockResolvedValueOnce(new Response('', { status: 502 }));
    const done = begin();
    await vi.waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(1));
    const utterance = synth.speak.mock.calls[0][0] as BrowserUtterance;
    expect(utterance.text).toBe('Why did you vote for Seven?');
    await begin();
    utterance.onend?.();
    await done;
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('stops active cloud playback when cancelled and never starts a fallback', async () => {
    request.mockResolvedValueOnce(wave());
    const done = begin();
    await vi.waitFor(() => expect(AudioPlayer.instances[0]?.play).toHaveBeenCalledTimes(1));
    const player = AudioPlayer.instances[0];
    cancel();
    await done;
    expect(player.pause).toHaveBeenCalledOnce();
    expect(isSpeaking()).toBe(false);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('falls back once with the same line after active playback fails', async () => {
    request.mockResolvedValueOnce(wave());
    const done = begin();
    await vi.waitFor(() => expect(AudioPlayer.instances[0]?.play).toHaveBeenCalledOnce());
    AudioPlayer.instances[0].onerror?.();
    await vi.waitFor(() => expect(synth.speak).toHaveBeenCalledOnce());
    const utterance = synth.speak.mock.calls[0][0] as BrowserUtterance;
    expect(utterance).toMatchObject({ text: line, lang: 'en-US' });
    utterance.onend?.();
    await done;
    await begin();
    expect(synth.speak).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
  });

  it('preserves the playback budget when paused again before resumed audio starts', async () => {
    vi.useFakeTimers();
    request.mockResolvedValueOnce(wave());
    const done = begin();
    await vi.advanceTimersByTimeAsync(0);
    const player = AudioPlayer.instances[0];
    const budget = speechMaxDurationMs(line);
    await vi.advanceTimersByTimeAsync(1000);
    pause();
    await vi.advanceTimersByTimeAsync(budget);
    player.play.mockImplementation(async () => {});
    resume();
    pause();
    await vi.advanceTimersByTimeAsync(100);
    resume();
    player.onplaying?.();

    await vi.advanceTimersByTimeAsync(budget - 1001);
    expect(isSpeaking()).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(isSpeaking()).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    expect(synth.speak).not.toHaveBeenCalled();
  });
});
