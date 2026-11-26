import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '../types';
import { getRoleShowcaseSpec } from './roleShowcaseConfig';
import {
  createRoleShowcaseSession,
  SHOWCASE_POST_MEDIA_HOLD_MS,
  type AudioElementLike,
  type VideoElementLike,
} from './roleShowcaseController';

class MockAudioElement implements AudioElementLike {
  src: string;
  volume = 1;
  currentTime = 0;
  error: unknown = null;
  playCalls = 0;
  pauseCalls = 0;
  private listeners: Record<'ended' | 'error', Set<() => void>> = {
    ended: new Set(),
    error: new Set(),
  };
  private playHandler: () => Promise<void>;

  constructor(src: string, playHandler?: () => Promise<void>) {
    this.src = src;
    this.playHandler = playHandler ?? (async () => undefined);
  }

  play(): Promise<void> {
    this.playCalls += 1;
    return this.playHandler();
  }

  pause(): void {
    this.pauseCalls += 1;
  }

  addEventListener(type: 'ended' | 'error', listener: () => void): void {
    this.listeners[type].add(listener);
  }

  removeEventListener(type: 'ended' | 'error', listener: () => void): void {
    this.listeners[type].delete(listener);
  }

  emit(type: 'ended' | 'error'): void {
    for (const listener of [...this.listeners[type]]) {
      listener();
    }
  }

  listenerCount(type: 'ended' | 'error'): number {
    return this.listeners[type].size;
  }
}

class MockVideoElement implements VideoElementLike {
  pauseCalls = 0;
  private listeners: Record<'ended' | 'error', Set<() => void>> = {
    ended: new Set(),
    error: new Set(),
  };

  pause(): void {
    this.pauseCalls += 1;
  }

  addEventListener(type: 'ended' | 'error', listener: () => void): void {
    this.listeners[type].add(listener);
  }

  removeEventListener(type: 'ended' | 'error', listener: () => void): void {
    this.listeners[type].delete(listener);
  }

  emit(type: 'ended' | 'error'): void {
    for (const listener of [...this.listeners[type]]) {
      listener();
    }
  }

  listenerCount(type: 'ended' | 'error'): number {
    return this.listeners[type].size;
  }
}

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('roleShowcaseController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes role title and subtitle immediately and enforces idempotent completion', () => {
    const onComplete = vi.fn();
    const session = createRoleShowcaseSession({
      mode: 'initial',
      role: Role.SEER,
      language: 'zh',
      isMuted: true,
      ttsEnabled: true,
      audioVolume: 1,
      prefersReducedMotion: false,
      onComplete,
    });

    const snap = session.getSnapshot();
    expect(snap.mode).toBe('initial');
    expect(snap.subtitle).toBe('水墨孤月之下，真假终见分晓。');
    expect(snap.roleTitle.length).toBeGreaterThan(0);

    expect(session.complete('skip')).toBe(true);
    expect(session.complete('escape')).toBe(false);
    expect(session.complete('close')).toBe(false);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('skip');
  });

  it('plays voice respecting volume and closes 2s after audio ends (not prematurely on video end)', async () => {
    let audio!: MockAudioElement;
    const video = new MockVideoElement();
    const onComplete = vi.fn();

    const session = createRoleShowcaseSession({
      mode: 'initial',
      role: Role.WITCH,
      language: 'en',
      isMuted: false,
      ttsEnabled: true,
      audioVolume: 0.65,
      prefersReducedMotion: false,
      onComplete,
      createAudio: src => {
        audio = new MockAudioElement(src);
        return audio;
      },
    });

    session.attachVideo(video);
    session.start();
    await flushMicrotasks();

    expect(audio.src).toBe('./assets/roles/witch/voice-en.mp3');
    expect(audio.volume).toBe(0.65);
    expect(audio.playCalls).toBe(1);
    expect(session.getSnapshot().autoplayBlocked).toBe(false);

    // Video ends earlier than audio: must NOT start premature close timer.
    video.emit('ended');
    await vi.advanceTimersByTimeAsync(SHOWCASE_POST_MEDIA_HOLD_MS + 500);
    expect(onComplete).not.toHaveBeenCalled();

    // Audio ends -> closes exactly 2000ms later.
    audio.emit('ended');
    await vi.advanceTimersByTimeAsync(SHOWCASE_POST_MEDIA_HOLD_MS - 1);
    expect(onComplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onComplete).toHaveBeenCalledWith('auto-end');
  });

  it.each([
    { label: 'muted', isMuted: true, ttsEnabled: true, audioVolume: 1 },
    { label: 'tts disabled', isMuted: false, ttsEnabled: false, audioVolume: 1 },
    { label: 'zero volume', isMuted: false, ttsEnabled: true, audioVolume: 0 },
  ])('does not play voice when $label and closes 2s after video ends', async prefs => {
    const createAudio = vi.fn(() => new MockAudioElement('unused'));
    const video = new MockVideoElement();
    const onComplete = vi.fn();

    const session = createRoleShowcaseSession({
      mode: 'replay',
      role: Role.HUNTER,
      language: 'en',
      ...prefs,
      prefersReducedMotion: false,
      onComplete,
      createAudio,
    });

    session.attachVideo(video);
    session.start();
    await flushMicrotasks();

    expect(createAudio).not.toHaveBeenCalled();
    expect(session.getSnapshot().autoplayBlocked).toBe(false);
    expect(session.getSnapshot().audioStatus).toBe('silenced');

    video.emit('ended');
    await vi.advanceTimersByTimeAsync(SHOWCASE_POST_MEDIA_HOLD_MS - 1);
    expect(onComplete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onComplete).toHaveBeenCalledWith('auto-end');
  });

  it('recovers from autoplay block via user tap, cancels fallback timer, and closes 2s after audio ends', async () => {
    let shouldBlock = true;
    let audio!: MockAudioElement;
    const video = new MockVideoElement();
    const onComplete = vi.fn();

    const session = createRoleShowcaseSession({
      mode: 'initial',
      role: Role.WEREWOLF,
      language: 'en',
      isMuted: false,
      ttsEnabled: true,
      audioVolume: 1,
      prefersReducedMotion: false,
      onComplete,
      createAudio: src => {
        audio = new MockAudioElement(src, async () => {
          if (shouldBlock) throw new DOMException('Blocked', 'NotAllowedError');
        });
        return audio;
      },
    });

    session.attachVideo(video);
    session.start();
    await flushMicrotasks();

    expect(session.getSnapshot().autoplayBlocked).toBe(true);
    expect(session.getSnapshot().audioStatus).toBe('blocked');

    // Video ends while autoplay is blocked -> starts 2000ms fallback timer.
    video.emit('ended');
    await vi.advanceTimersByTimeAsync(1500);
    expect(onComplete).not.toHaveBeenCalled();

    // User taps "Tap to play voice" before 2000ms expires -> cancels fallback timer.
    shouldBlock = false;
    const played = await session.playVoiceFromUserGesture();
    expect(played).toBe(true);
    expect(session.getSnapshot().autoplayBlocked).toBe(false);

    // Original video-end fallback timer must be cancelled!
    await vi.advanceTimersByTimeAsync(3000);
    expect(onComplete).not.toHaveBeenCalled();

    // Now audio ends -> closes 2000ms later.
    audio.emit('ended');
    await vi.advanceTimersByTimeAsync(SHOWCASE_POST_MEDIA_HOLD_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith('auto-end');
  });

  it('falls back to presetDurationMs + 2000ms on video error or reduced motion', async () => {
    const spec = getRoleShowcaseSpec(Role.IDIOT);
    const onCompleteReduced = vi.fn();
    const reducedSession = createRoleShowcaseSession({
      mode: 'initial',
      role: Role.IDIOT,
      language: 'en',
      isMuted: true,
      ttsEnabled: true,
      audioVolume: 1,
      prefersReducedMotion: true,
      onComplete: onCompleteReduced,
    });
    reducedSession.start();
    await vi.advanceTimersByTimeAsync(spec.presetDurationMs + SHOWCASE_POST_MEDIA_HOLD_MS - 1);
    expect(onCompleteReduced).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onCompleteReduced).toHaveBeenCalledWith('auto-end');

    const onCompleteVideoErr = vi.fn();
    const video = new MockVideoElement();
    const errorSession = createRoleShowcaseSession({
      mode: 'initial',
      role: Role.IDIOT,
      language: 'en',
      isMuted: true,
      ttsEnabled: true,
      audioVolume: 1,
      prefersReducedMotion: false,
      onComplete: onCompleteVideoErr,
    });
    errorSession.attachVideo(video);
    errorSession.start();
    video.emit('error');
    await vi.advanceTimersByTimeAsync(spec.presetDurationMs + SHOWCASE_POST_MEDIA_HOLD_MS);
    expect(onCompleteVideoErr).toHaveBeenCalledWith('auto-end');
  });

  it('clears autoplayBlocked on audio error and cleans up all timers/listeners on dispose', async () => {
    let audio!: MockAudioElement;
    const video = new MockVideoElement();
    const onComplete = vi.fn();

    const session = createRoleShowcaseSession({
      mode: 'initial',
      role: Role.VILLAGER,
      language: 'en',
      isMuted: false,
      ttsEnabled: true,
      audioVolume: 1,
      prefersReducedMotion: false,
      onComplete,
      createAudio: src => {
        audio = new MockAudioElement(src, async () => {
          throw new DOMException('Blocked', 'NotAllowedError');
        });
        return audio;
      },
    });

    session.attachVideo(video);
    session.start();
    await flushMicrotasks();
    expect(session.getSnapshot().autoplayBlocked).toBe(true);

    audio.emit('error');
    expect(session.getSnapshot().autoplayBlocked).toBe(false);
    expect(session.getSnapshot().audioStatus).toBe('error');

    video.emit('ended');
    expect(audio.listenerCount('ended')).toBe(1);
    expect(video.listenerCount('ended')).toBe(1);

    // Match exit / dispose cleans up timers, listeners, and media without calling onComplete.
    session.dispose();
    expect(audio.listenerCount('ended')).toBe(0);
    expect(audio.listenerCount('error')).toBe(0);
    expect(video.listenerCount('ended')).toBe(0);
    expect(video.listenerCount('error')).toBe(0);
    expect(audio.pauseCalls).toBeGreaterThanOrEqual(1);
    expect(video.pauseCalls).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
