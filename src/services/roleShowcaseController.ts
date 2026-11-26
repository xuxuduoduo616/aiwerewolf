import type { DisplayLanguage } from '../i18n';
import { Role } from '../types';
import {
  getRoleShowcaseSpec,
  getShowcaseText,
  type RoleShowcaseSpec,
} from './roleShowcaseConfig';

export const SHOWCASE_POST_MEDIA_HOLD_MS = 2000;

export type ShowcaseMode = 'initial' | 'replay';
export type ShowcaseCompleteReason = 'auto-end' | 'skip' | 'escape' | 'close';
export type ShowcaseAudioStatus = 'idle' | 'playing' | 'blocked' | 'silenced' | 'ended' | 'error';
export type ShowcaseVideoStatus = 'playing' | 'ended' | 'error' | 'reduced-motion';

export interface AudioElementLike {
  src: string;
  volume: number;
  currentTime?: number;
  error?: unknown;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: 'ended' | 'error', listener: () => void): void;
  removeEventListener(type: 'ended' | 'error', listener: () => void): void;
}

export interface VideoElementLike {
  pause?(): void;
  addEventListener(type: 'ended' | 'error', listener: () => void): void;
  removeEventListener(type: 'ended' | 'error', listener: () => void): void;
}

export interface TimerDriver {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof globalThis.setTimeout>;
  clearTimeout(handle: ReturnType<typeof globalThis.setTimeout>): void;
}

export interface RoleShowcaseSessionOptions {
  mode: ShowcaseMode;
  role: Role;
  language: DisplayLanguage;
  isMuted: boolean;
  ttsEnabled: boolean;
  audioVolume: number;
  prefersReducedMotion?: boolean;
  videoAvailable?: boolean;
  onComplete?: (reason: ShowcaseCompleteReason) => void;
  createAudio?: (src: string) => AudioElementLike | null;
  timers?: TimerDriver;
}

export interface RoleShowcaseSnapshot {
  mode: ShowcaseMode;
  role: Role;
  language: DisplayLanguage;
  spec: RoleShowcaseSpec;
  roleTitle: string;
  subtitle: string;
  badgeLabel: string;
  audioStatus: ShowcaseAudioStatus;
  videoStatus: ShowcaseVideoStatus;
  autoplayBlocked: boolean;
  completed: boolean;
  completeReason: ShowcaseCompleteReason | null;
}

export interface RoleShowcaseSession {
  getSnapshot(): RoleShowcaseSnapshot;
  subscribe(listener: (snapshot: RoleShowcaseSnapshot) => void): () => void;
  start(): void;
  attachVideo(video: VideoElementLike | null): () => void;
  handleVideoEnded(): void;
  handleVideoError(): void;
  playVoiceFromUserGesture(): Promise<boolean>;
  updateAudioPreferences(prefs: { isMuted: boolean; ttsEnabled: boolean; audioVolume: number }): void;
  complete(reason: ShowcaseCompleteReason): boolean;
  dispose(): void;
}

const detectReducedMotion = (): boolean =>
  typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const defaultCreateAudio = (src: string): AudioElementLike | null => {
  if (typeof Audio === 'undefined') return null;
  try {
    return new Audio(src);
  } catch {
    return null;
  }
};

const defaultTimers: TimerDriver = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle),
};

const clampVolume = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

export function createRoleShowcaseSession(
  options: RoleShowcaseSessionOptions,
): RoleShowcaseSession {
  const spec = getRoleShowcaseSpec(options.role);
  const reducedMotion = options.prefersReducedMotion ?? detectReducedMotion();
  const timers = options.timers ?? defaultTimers;
  const createAudio = options.createAudio ?? defaultCreateAudio;

  const roleTitle = getShowcaseText(spec.roleTitle, options.language);
  const subtitle = getShowcaseText(spec.subtitle, options.language);
  const badgeLabel = getShowcaseText(spec.badgeLabel, options.language);

  let isMuted = options.isMuted;
  let ttsEnabled = options.ttsEnabled;
  let audioVolume = clampVolume(options.audioVolume);

  let videoStatus: ShowcaseVideoStatus = reducedMotion
    ? 'reduced-motion'
    : (options.videoAvailable ?? true)
      ? 'playing'
      : 'error';
  let audioStatus: ShowcaseAudioStatus = 'idle';
  let autoplayBlocked = false;
  let completed = false;
  let completeReason: ShowcaseCompleteReason | null = null;
  let disposed = false;
  let started = false;

  let holdTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let timerKind: 'audio-end' | 'video-end' | 'preset-fallback' | null = null;
  let playAttemptId = 0;

  let audio: AudioElementLike | null = null;
  let audioCleanup: (() => void) | null = null;
  let attachedVideo: VideoElementLike | null = null;
  let videoCleanup: (() => void) | null = null;

  const listeners = new Set<(snapshot: RoleShowcaseSnapshot) => void>();

  const isAudioSilenced = () => isMuted || !ttsEnabled || audioVolume <= 0;

  const buildSnapshot = (): RoleShowcaseSnapshot => ({
    mode: options.mode,
    role: options.role,
    language: options.language,
    spec,
    roleTitle,
    subtitle,
    badgeLabel,
    audioStatus,
    videoStatus,
    autoplayBlocked,
    completed,
    completeReason,
  });

  const emit = () => {
    const snap = buildSnapshot();
    listeners.forEach(listener => listener(snap));
  };

  const clearHoldTimer = () => {
    if (holdTimer !== null) {
      timers.clearTimeout(holdTimer);
      holdTimer = null;
    }
    timerKind = null;
  };

  const scheduleCloseAfter = (
    ms: number,
    kind: 'audio-end' | 'video-end' | 'preset-fallback',
  ) => {
    if (completed || disposed) return;
    if (timerKind === kind && holdTimer !== null) return;
    clearHoldTimer();
    timerKind = kind;
    holdTimer = timers.setTimeout(() => {
      holdTimer = null;
      timerKind = null;
      complete('auto-end');
    }, ms);
  };

  const recomputeTimeline = () => {
    if (completed || disposed || !started) return;

    if (audioStatus === 'playing') {
      clearHoldTimer();
      return;
    }

    if (audioStatus === 'ended') {
      scheduleCloseAfter(SHOWCASE_POST_MEDIA_HOLD_MS, 'audio-end');
      return;
    }

    if (videoStatus === 'ended') {
      scheduleCloseAfter(SHOWCASE_POST_MEDIA_HOLD_MS, 'video-end');
      return;
    }

    if (videoStatus === 'error' || videoStatus === 'reduced-motion') {
      scheduleCloseAfter(spec.presetDurationMs + SHOWCASE_POST_MEDIA_HOLD_MS, 'preset-fallback');
      return;
    }

    clearHoldTimer();
  };

  const detachAudio = () => {
    audioCleanup?.();
    audioCleanup = null;
    if (audio) {
      try { audio.pause(); } catch { /* ignore media teardown error */ }
      try {
        if (typeof audio.currentTime === 'number') audio.currentTime = 0;
      } catch { /* ignore seek error */ }
      try { audio.src = ''; } catch { /* ignore src reset error */ }
      audio = null;
    }
  };

  const detachVideo = () => {
    if (attachedVideo) {
      try { attachedVideo.pause?.(); } catch { /* ignore video pause error */ }
    }
    videoCleanup?.();
    videoCleanup = null;
    attachedVideo = null;
  };

  const cleanup = () => {
    playAttemptId += 1;
    clearHoldTimer();
    detachAudio();
    detachVideo();
  };

  const ensureAudioElement = (): AudioElementLike | null => {
    if (audio) return audio;
    const created = createAudio(spec.voiceSrc[options.language]);
    if (!created) return null;
    audio = created;
    audio.volume = audioVolume;

    const onEnded = () => {
      if (completed || disposed || audio !== created) return;
      playAttemptId += 1;
      audioStatus = 'ended';
      autoplayBlocked = false;
      recomputeTimeline();
      emit();
    };

    const onError = () => {
      if (completed || disposed || audio !== created) return;
      playAttemptId += 1;
      audioStatus = 'error';
      autoplayBlocked = false;
      recomputeTimeline();
      emit();
    };

    created.addEventListener('ended', onEnded);
    created.addEventListener('error', onError);
    audioCleanup = () => {
      created.removeEventListener('ended', onEnded);
      created.removeEventListener('error', onError);
    };
    return created;
  };

  const attemptAudioPlay = async (): Promise<boolean> => {
    if (completed || disposed) return false;
    if (isAudioSilenced()) {
      audioStatus = 'silenced';
      autoplayBlocked = false;
      recomputeTimeline();
      emit();
      return false;
    }

    const element = ensureAudioElement();
    if (!element) {
      audioStatus = 'error';
      autoplayBlocked = false;
      recomputeTimeline();
      emit();
      return false;
    }

    element.volume = audioVolume;
    const attemptId = ++playAttemptId;
    audioStatus = 'playing';
    autoplayBlocked = false;
    clearHoldTimer();
    emit();

    try {
      await Promise.resolve(element.play());
      if (completed || disposed || attemptId !== playAttemptId) return false;
      return true;
    } catch {
      if (completed || disposed || attemptId !== playAttemptId) return false;
      if (isAudioSilenced()) {
        audioStatus = 'silenced';
        autoplayBlocked = false;
      } else if (element.error) {
        audioStatus = 'error';
        autoplayBlocked = false;
      } else {
        audioStatus = 'blocked';
        autoplayBlocked = true;
      }
      recomputeTimeline();
      emit();
      return false;
    }
  };

  const start = () => {
    if (started || completed || disposed) return;
    started = true;
    if (isAudioSilenced()) {
      audioStatus = 'silenced';
      autoplayBlocked = false;
      recomputeTimeline();
      emit();
      return;
    }
    void attemptAudioPlay();
  };

  const attachVideo = (video: VideoElementLike | null): (() => void) => {
    detachVideo();
    if (!video || completed || disposed || reducedMotion) {
      return () => undefined;
    }
    attachedVideo = video;

    const onEnded = () => handleVideoEnded();
    const onError = () => handleVideoError();
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    const cleanupVideo = () => {
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onError);
      if (attachedVideo === video) attachedVideo = null;
    };
    videoCleanup = cleanupVideo;
    return cleanupVideo;
  };

  const handleVideoEnded = () => {
    if (completed || disposed || videoStatus === 'reduced-motion' || videoStatus === 'error') return;
    videoStatus = 'ended';
    recomputeTimeline();
    emit();
  };

  const handleVideoError = () => {
    if (completed || disposed || videoStatus === 'reduced-motion') return;
    videoStatus = 'error';
    recomputeTimeline();
    emit();
  };

  const playVoiceFromUserGesture = async (): Promise<boolean> => {
    if (completed || disposed) return false;
    if (!started) started = true;
    clearHoldTimer();
    return attemptAudioPlay();
  };

  const updateAudioPreferences = (prefs: {
    isMuted: boolean;
    ttsEnabled: boolean;
    audioVolume: number;
  }) => {
    if (completed || disposed) return;
    isMuted = prefs.isMuted;
    ttsEnabled = prefs.ttsEnabled;
    audioVolume = clampVolume(prefs.audioVolume);

    if (audio) {
      audio.volume = audioVolume;
    }

    if (isAudioSilenced()) {
      playAttemptId += 1;
      if (audio) {
        try { audio.pause(); } catch { /* ignore */ }
      }
      if (audioStatus !== 'ended' && audioStatus !== 'error') {
        audioStatus = 'silenced';
      }
      autoplayBlocked = false;
      recomputeTimeline();
      emit();
      return;
    }

    if (started && audioStatus === 'silenced') {
      void attemptAudioPlay();
    }
  };

  const complete = (reason: ShowcaseCompleteReason): boolean => {
    if (completed) return false;
    completed = true;
    completeReason = reason;
    cleanup();
    emit();
    options.onComplete?.(reason);
    return true;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cleanup();
    listeners.clear();
  };

  const subscribe = (listener: (snapshot: RoleShowcaseSnapshot) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    getSnapshot: buildSnapshot,
    subscribe,
    start,
    attachVideo,
    handleVideoEnded,
    handleVideoError,
    playVoiceFromUserGesture,
    updateAudioPreferences,
    complete,
    dispose,
  };
}
