import { useCallback, useEffect, useRef, useState } from 'react';
import { GamePhase } from '../types';
import {
  fetchBgmBytes,
  getSharedBgmAudioContext,
  loadBgmAudioBuffer,
  readBgmPrefs,
  subscribeBgmPrefs,
  writeBgmPrefs,
} from '../services/bgmPrefs';
import { isAudiblySpeaking, subscribeSpeechActivity } from '../services/speechAudio';

export type MatchBgmMovement = 'night' | 'day' | 'vote' | 'epilogue';

export const GAME_BGM_SOURCES: Record<MatchBgmMovement, string> = {
  night: '/assets/bgm/game-night-bgm.mp3',
  day: '/assets/bgm/game-day-bgm.mp3',
  vote: '/assets/bgm/game-vote-bgm.mp3',
  epilogue: '/assets/bgm/hongchen-kezhan.mp3',
};

export const resolveMatchBgmMovement = (phase: GamePhase): MatchBgmMovement | null => {
  switch (phase) {
    case GamePhase.NIGHT_START:
    case GamePhase.NIGHT_WEREWOLVES:
    case GamePhase.NIGHT_SEER:
    case GamePhase.NIGHT_WITCH:
      return 'night';
    case GamePhase.DAY_ANNOUNCE:
    case GamePhase.DAY_DISCUSSION:
      return 'day';
    case GamePhase.DAY_VOTING:
    case GamePhase.DAY_HUNTER_CHECK:
    case GamePhase.DAY_HUNTER_SHOT:
      return 'vote';
    case GamePhase.GAME_OVER:
      return 'epilogue';
    default:
      return null;
  }
};

export interface GameBgmOptions {
  phase: GamePhase;
  isMuted: boolean;
  volume: number;
  isPaused: boolean;
  overlayActive: boolean;
  urgentVote: boolean;
}

export interface GameBgmState {
  bgmEnabled: boolean;
  movement: MatchBgmMovement | null;
  isDuckedForSpeech: boolean;
  toggleBgm: () => void;
}

const BASE_MOVEMENT_GAIN: Record<MatchBgmMovement, number> = {
  night: 0.36,
  day: 0.34,
  vote: 0.38,
  epilogue: 0.34,
};

const CROSSFADE_SEC = 1.25;
const SPEECH_RELEASE_DEBOUNCE_MS = 480;

/**
 * Adaptive In-Game Jianghu × Werewolf Interactive Soundtrack Engine:
 * 1. Crossfades smoothly across nocturnal suspense (`night`), teahouse deduction (`day`),
 *    rubato/accelerando exile standoff (`vote`), and reflective epilogue (`epilogue`).
 * 2. Listens to real-time Qwen cloud TTS & browser TTS speech activity, simultaneously
 *    ducking volume to 26% and sweeping a warm 980 Hz silk-screen low-pass + 1.85 kHz
 *    vocal-presence carve so AI voices stand in crystal-clear focus.
 */
export const useGameBgm = ({
  phase,
  isMuted,
  volume,
  isPaused,
  overlayActive,
  urgentVote,
}: GameBgmOptions): GameBgmState => {
  const [bgmEnabled, setBgmEnabled] = useState<boolean>(() => readBgmPrefs().enabled);
  const [speechDucked, setSpeechDucked] = useState<boolean>(() => isAudiblySpeaking());

  const movement = resolveMatchBgmMovement(phase);

  // Sync with shared BGM preference
  useEffect(() => subscribeBgmPrefs(prefs => setBgmEnabled(prefs.enabled)), []);

  // Track real-time Qwen / browser TTS speech with smooth multi-chunk hold debounce
  useEffect(() => {
    let releaseTimer: number | undefined;
    const apply = (audible: boolean) => {
      if (releaseTimer !== undefined) {
        window.clearTimeout(releaseTimer);
        releaseTimer = undefined;
      }
      if (audible) {
        setSpeechDucked(true);
      } else {
        releaseTimer = window.setTimeout(() => {
          setSpeechDucked(false);
        }, SPEECH_RELEASE_DEBOUNCE_MS);
      }
    };
    apply(isAudiblySpeaking());
    const unsub = subscribeSpeechActivity(apply);
    return () => {
      unsub();
      if (releaseTimer !== undefined) window.clearTimeout(releaseTimer);
    };
  }, []);

  // Pre-warm adjacent match movements during idle time
  useEffect(() => {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return undefined;
    const timer = window.setTimeout(() => {
      void fetchBgmBytes(GAME_BGM_SOURCES.night).catch(() => undefined);
      void fetchBgmBytes(GAME_BGM_SOURCES.day).catch(() => undefined);
      void fetchBgmBytes(GAME_BGM_SOURCES.vote).catch(() => undefined);
    }, 500);
    return () => window.clearTimeout(timer);
  }, []);

  const busRef = useRef<{
    ctx: AudioContext;
    carveFilter: BiquadFilterNode;
    lowpassFilter: BiquadFilterNode;
    masterGain: GainNode;
  } | null>(null);

  const activeNodeRef = useRef<{
    movement: MatchBgmMovement;
    source: AudioBufferSourceNode;
    gain: GainNode;
    startedAt: number;
  } | null>(null);

  const offsetsRef = useRef<Record<MatchBgmMovement, number>>({
    night: 0,
    day: 0,
    vote: 0,
    epilogue: 0,
  });

  const fadeOutAndStop = useCallback((
    ctx: AudioContext,
    node: { movement: MatchBgmMovement; source: AudioBufferSourceNode; gain: GainNode; startedAt: number },
    fadeSec: number,
  ) => {
    node.source.onended = null;
    if (node.source.buffer && node.source.buffer.duration > 0) {
      const elapsed = Math.max(0, ctx.currentTime - node.startedAt);
      offsetsRef.current[node.movement] =
        (offsetsRef.current[node.movement] + elapsed) % node.source.buffer.duration;
    }
    try {
      const now = ctx.currentTime;
      node.gain.gain.cancelScheduledValues(now);
      node.gain.gain.setValueAtTime(Math.max(0.0001, node.gain.gain.value), now);
      node.gain.gain.linearRampToValueAtTime(0.0001, now + fadeSec);
      window.setTimeout(() => {
        try {
          node.source.stop();
          node.source.disconnect();
          node.gain.disconnect();
        } catch {
          // Already stopped
        }
      }, Math.ceil(fadeSec * 1000) + 30);
    } catch {
      // Ignore disposed nodes
    }
  }, []);

  // Ensure shared master DSP bus (`carveFilter -> lowpassFilter -> masterGain -> destination`)
  const ensureBus = useCallback((ctx: AudioContext) => {
    if (busRef.current && busRef.current.ctx === ctx) return busRef.current;

    const carveFilter = ctx.createBiquadFilter();
    carveFilter.type = 'peaking';
    carveFilter.frequency.value = 1850;
    carveFilter.Q.value = 0.95;
    carveFilter.gain.value = 0;

    const lowpassFilter = ctx.createBiquadFilter();
    lowpassFilter.type = 'lowpass';
    lowpassFilter.frequency.value = 18000;
    lowpassFilter.Q.value = 0.65;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 1;

    carveFilter.connect(lowpassFilter);
    lowpassFilter.connect(masterGain);
    masterGain.connect(ctx.destination);

    const bus = { ctx, carveFilter, lowpassFilter, masterGain };
    busRef.current = bus;
    return bus;
  }, []);

  // Movement switcher & crossfader
  useEffect(() => {
    const shouldPlay = Boolean(movement) && bgmEnabled && !isMuted && volume > 0;
    if (!shouldPlay || !movement) {
      const prev = activeNodeRef.current;
      const ctx = busRef.current?.ctx;
      if (prev && ctx) {
        activeNodeRef.current = null;
        fadeOutAndStop(ctx, prev, 0.35);
      }
      return undefined;
    }

    if (activeNodeRef.current?.movement === movement) {
      return undefined;
    }

    const ctx = getSharedBgmAudioContext();
    if (!ctx || typeof fetch !== 'function') return undefined;

    let cancelled = false;

    const switchMovement = async () => {
      try {
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => undefined);
        }
        if (cancelled || ctx.state !== 'running') return;

        const buffer = await loadBgmAudioBuffer(ctx, GAME_BGM_SOURCES[movement]);
        if (cancelled) return;

        const bus = ensureBus(ctx);
        const prev = activeNodeRef.current;
        if (prev) {
          activeNodeRef.current = null;
          fadeOutAndStop(ctx, prev, CROSSFADE_SEC);
        }

        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffer;
        source.loop = true;

        const targetLevel = BASE_MOVEMENT_GAIN[movement];
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(targetLevel, now + CROSSFADE_SEC);

        source.connect(gain);
        gain.connect(bus.carveFilter);

        const offset = buffer.duration > 0 ? offsetsRef.current[movement] % buffer.duration : 0;
        offsetsRef.current[movement] = offset;
        source.start(0, offset);

        activeNodeRef.current = { movement, source, gain, startedAt: now };
      } catch {
        // BGM is atmospheric polish — never surface errors into match logic.
      }
    };

    void switchMovement();

    return () => {
      cancelled = true;
    };
  }, [bgmEnabled, ensureBus, fadeOutAndStop, isMuted, movement, volume]);

  // Dynamic real-time DSP adaptation (AI speech ducking + chamber filter + overlay/pause/urgency)
  useEffect(() => {
    const bus = busRef.current;
    if (!bus) return;
    const { ctx, carveFilter, lowpassFilter, masterGain } = bus;
    const now = ctx.currentTime;

    const clampedVol = Math.max(0, Math.min(1, volume));
    let duckMultiplier = 1.0;
    let targetLowpassHz = 18000;
    let targetCarveDb = 0;

    if (!bgmEnabled || isMuted || clampedVol <= 0) {
      duckMultiplier = 0.0001;
    } else if (overlayActive) {
      // Role showcase entrance video or night skill SFX active: step deep into background
      duckMultiplier = 0.12;
      targetLowpassHz = 900;
      targetCarveDb = -6.0;
    } else if (speechDucked) {
      // Qwen / Browser AI Voiceover speaking: duck volume + warm silk-screen chamber style!
      duckMultiplier = 0.26;
      targetLowpassHz = 980;
      targetCarveDb = -5.5;
    } else if (isPaused) {
      duckMultiplier = 0.45;
      targetLowpassHz = 2400;
      targetCarveDb = -2.0;
    }

    const finalBusGain = Math.max(0.0001, clampedVol * duckMultiplier);
    const gainTau = speechDucked || overlayActive ? 0.09 : 0.24;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(finalBusGain, now, gainTau);

    lowpassFilter.frequency.cancelScheduledValues(now);
    lowpassFilter.frequency.setTargetAtTime(targetLowpassHz, now, 0.14);

    carveFilter.gain.cancelScheduledValues(now);
    carveFilter.gain.setTargetAtTime(targetCarveDb, now, 0.12);

    // Subtle heartbeat tempo nudge during final 5s of Exile Vote
    const activeNode = activeNodeRef.current;
    if (activeNode) {
      const targetRate = activeNode.movement === 'vote' && urgentVote && !isPaused ? 1.05 : 1.0;
      activeNode.source.playbackRate.cancelScheduledValues(now);
      activeNode.source.playbackRate.setTargetAtTime(targetRate, now, 0.25);
    }
  }, [bgmEnabled, isMuted, isPaused, overlayActive, speechDucked, urgentVote, volume]);

  // Clean up on unmount (leaving GameScreen back to Lobby)
  useEffect(() => () => {
    const prev = activeNodeRef.current;
    const bus = busRef.current;
    activeNodeRef.current = null;
    if (prev && bus) {
      fadeOutAndStop(bus.ctx, prev, 0.35);
    }
  }, [fadeOutAndStop]);

  const toggleBgm = useCallback(() => {
    const ctx = getSharedBgmAudioContext();
    if (ctx?.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }
    writeBgmPrefs({ enabled: !bgmEnabled });
  }, [bgmEnabled]);

  return {
    bgmEnabled,
    movement,
    isDuckedForSpeech: speechDucked,
    toggleBgm,
  };
};
