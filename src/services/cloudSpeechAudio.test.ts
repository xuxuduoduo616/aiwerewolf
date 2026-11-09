import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __test, cancel, pause, resume, enqueue, isSpeaking, setEnabled, speechMaxDurationMs } from './speechAudio';
import { CLOUD_SPEECH_LIMIT, ENGLISH_REQUEST_TIMEOUT_MS, splitCloudSpeech } from './cloudSpeechAudio';

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

const longLine = 'I want to hear from Seven before we vote. '.repeat(20).trim();

describe('long cloud speech', () => {
  it('preserves every code point and caps each clip', () => {
    const text = ('I think Player 7 is lying. ').repeat(40) + '😀'.repeat(50);
    const chunks = splitCloudSpeech(text);
    expect(chunks).not.toBeNull();
    expect(chunks!.join('')).toBe(text);
    expect(chunks!.length).toBeGreaterThan(1);
    for (const chunk of chunks!) {
      expect([...chunk].length).toBeLessThanOrEqual(CLOUD_SPEECH_LIMIT);
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
    expect(splitCloudSpeech('   ')).toBeNull();
  });

  it('splits an overlong token at the client target', () => {
    expect(splitCloudSpeech('A'.repeat(1300))).toEqual([
      'A'.repeat(CLOUD_SPEECH_LIMIT),
      'A'.repeat(CLOUD_SPEECH_LIMIT),
      'A'.repeat(CLOUD_SPEECH_LIMIT),
      'A'.repeat(1300 - CLOUD_SPEECH_LIMIT * 3),
    ]);
  });

  it('keeps every clip under the provider request limit', () => {
    const text = 'I think Player 7 is lying. '.repeat(80);
    const chunks = splitCloudSpeech(text)!;
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect([...chunk].length).toBeLessThanOrEqual(CLOUD_SPEECH_LIMIT);
      expect([...chunk].length).toBeLessThanOrEqual(600);
    }
    expect(chunks.join('')).toBe(text);
  });

  it('prefers sentence boundaries for Chinese text', () => {
    const sentence = '我怀疑三号是狼人，因为他昨天一直在改票。';
    const text = sentence.repeat(40);
    const chunks = splitCloudSpeech(text);
    expect(chunks).not.toBeNull();
    expect(chunks!.join('')).toBe(text);
    expect(chunks![0].endsWith('。')).toBe(true);
  });

  it('plays long text as sequential cloud clips without browser fallback', async () => {
    request.mockImplementation(async () => wave());
    const done = enqueue(longLine, 'en-US', 2, 'long-turn', 'fake-token');
    const chunks = splitCloudSpeech(longLine)!;
    for (let index = 0; index < chunks.length; index++) {
      await vi.waitFor(() => expect(AudioPlayer.instances).toHaveLength(index + 1));
      AudioPlayer.instances[index].onended?.();
    }
    await done;
    expect(request).toHaveBeenCalledTimes(chunks.length);
    const sent = request.mock.calls.map(call => JSON.parse(call[1].body).text as string);
    expect(sent.join('')).toBe(longLine);
    expect(sent.every(text => [...text].length <= CLOUD_SPEECH_LIMIT)).toBe(true);
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('falls back only to the unplayed suffix when a later clip fails', async () => {
    request.mockImplementationOnce(async () => wave())
      .mockResolvedValueOnce(new Response('', { status: 502 }));
    const done = enqueue(longLine, 'en-US', 2, 'long-suffix', 'fake-token');
    const chunks = splitCloudSpeech(longLine)!;
    await vi.waitFor(() => expect(AudioPlayer.instances).toHaveLength(1));
    AudioPlayer.instances[0].onended?.();
    await vi.waitFor(() => expect(synth.speak).toHaveBeenCalledOnce());
    const utterance = synth.speak.mock.calls[0][0] as BrowserUtterance;
    expect(utterance.text).toBe(chunks.slice(1).join(''));
    expect(utterance.text).not.toBe(longLine);
    utterance.onend?.();
    await done;
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('cloud request budgets', () => {
  it('waits the wider English budget before falling back', async () => {
    vi.useFakeTimers();
    request.mockImplementation(() => new Promise(() => {}));
    const done = enqueue(line, 'en-US', 2, 'en-timeout', 'fake-token');
    await vi.advanceTimersByTimeAsync(ENGLISH_REQUEST_TIMEOUT_MS - 1);
    expect(isSpeaking()).toBe(true);
    expect(synth.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(synth.speak).toHaveBeenCalledOnce();
    const utterance = synth.speak.mock.calls[0][0] as BrowserUtterance;
    expect(utterance.text).toBe(line);
    utterance.onend?.();
    await done;
  });

  it('keeps the shorter Chinese budget', async () => {
    vi.useFakeTimers();
    request.mockImplementation(() => new Promise(() => {}));
    const done = enqueue('你为什么投三号？', 'zh-CN', 2, 'zh-timeout', 'fake-token');
    await vi.advanceTimersByTimeAsync(6_499);
    expect(isSpeaking()).toBe(true);
    expect(synth.speak).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(synth.speak).toHaveBeenCalledOnce();
    const utterance = synth.speak.mock.calls[0][0] as BrowserUtterance;
    utterance.onend?.();
    await done;
  });

  it('holds a paused request and plays it after resume without re-fetching', async () => {
    vi.useFakeTimers();
    let respond!: (value: Response) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { respond = resolve; }));
    const done = enqueue(line, 'en-US', 2, 'pause-fetch', 'fake-token');
    pause();
    await vi.advanceTimersByTimeAsync(ENGLISH_REQUEST_TIMEOUT_MS * 2);
    expect(synth.speak).not.toHaveBeenCalled();
    respond(wave());
    await vi.advanceTimersByTimeAsync(0);
    expect(AudioPlayer.instances).toHaveLength(1);
    expect(AudioPlayer.instances[0].play).not.toHaveBeenCalled();
    resume();
    expect(AudioPlayer.instances[0].play).toHaveBeenCalledOnce();
    AudioPlayer.instances[0].onended?.();
    await done;
    expect(request).toHaveBeenCalledOnce();
  });
});
