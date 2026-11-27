import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchBgmBytes,
  getSharedBgmAudioContext,
  loadBgmAudioBuffer,
  readBgmPrefs,
  subscribeBgmPrefs,
  writeBgmPrefs,
} from '../services/bgmPrefs';
import {
  LOBBY_BGM_TRACKS,
  nextTrackIndex,
  normalizeTrackIndex,
  prevTrackIndex,
  type BgmTrack,
} from '../services/lobbyBgmTracks';

const TARGET_GAIN = 0.42;
const FADE_IN_SEC = 0.55;
const FADE_OUT_SEC = 0.22;

export interface LobbyBgmController {
  readonly track: BgmTrack;
  readonly trackIndex: number;
  readonly trackCount: number;
  readonly enabled: boolean;
  readonly isPlaying: boolean;
  readonly toggle: () => void;
  readonly next: () => void;
  readonly prev: () => void;
}

/** Pre-fetches the default Lobby track during Sign-In idle time for instant start. */
export const prefetchLobbyBgm = (): void => {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  const first = LOBBY_BGM_TRACKS[0];
  if (first) void fetchBgmBytes(first.src).catch(() => undefined);
};

/**
 * Manages Lobby background music via Web Audio API (`AudioBufferSourceNode` + `GainNode`),
 * synchronized with `bgmPrefs` and isolated from `HTMLAudioElement` voiceover pipelines.
 */
export const useLobbyBgm = (active: boolean): LobbyBgmController => {
  const initial = useRef(readBgmPrefs());
  const [enabled, setEnabled] = useState<boolean>(initial.current.enabled);
  const [trackIndex, setTrackIndex] = useState<number>(initial.current.trackIndex);
  const [revision, setRevision] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const offsetRef = useRef<number>(0);
  const startedAtRef = useRef<number>(0);
  const activeTrackIdRef = useRef<string | null>(null);
  const enabledRef = useRef(enabled);
  const activeRef = useRef(active);
  enabledRef.current = enabled;
  activeRef.current = active;

  useEffect(() => subscribeBgmPrefs(prefs => {
    setEnabled(prefs.enabled);
    setTrackIndex(prefs.trackIndex);
  }), []);

  const track = LOBBY_BGM_TRACKS[normalizeTrackIndex(trackIndex)] ?? LOBBY_BGM_TRACKS[0];

  const stopCurrentSource = useCallback((recordOffset: boolean) => {
    const srcNode = sourceRef.current;
    const gainNode = gainRef.current;
    const ctx = getSharedBgmAudioContext();
    sourceRef.current = null;
    gainRef.current = null;

    if (srcNode && ctx) {
      srcNode.onended = null;
      if (recordOffset && srcNode.buffer && srcNode.buffer.duration > 0) {
        const elapsed = Math.max(0, ctx.currentTime - startedAtRef.current);
        offsetRef.current = (offsetRef.current + elapsed) % srcNode.buffer.duration;
      }
      try {
        if (gainNode) {
          const now = ctx.currentTime;
          gainNode.gain.cancelScheduledValues(now);
          gainNode.gain.setValueAtTime(Math.max(0.0001, gainNode.gain.value), now);
          gainNode.gain.linearRampToValueAtTime(0.0001, now + FADE_OUT_SEC);
          window.setTimeout(() => {
            try { srcNode.stop(); srcNode.disconnect(); gainNode.disconnect(); } catch { /* already stopped */ }
          }, Math.ceil(FADE_OUT_SEC * 1000) + 20);
        } else {
          srcNode.stop();
          srcNode.disconnect();
        }
      } catch {
        // Ignore already-stopped nodes.
      }
    }
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    if (!active || !enabled) {
      stopCurrentSource(true);
      return undefined;
    }

    const ctx = getSharedBgmAudioContext();
    if (!ctx || typeof fetch !== 'function') {
      return undefined;
    }

    let cancelled = false;
    let unlockCleanup: (() => void) | null = null;

    const startPlayback = async () => {
      try {
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => undefined);
        }
        if (cancelled) return;

        if (ctx.state !== 'running') {
          setIsPlaying(false);
          if (!unlockCleanup) {
            const onFirstGesture = () => {
              unlockCleanup?.();
              unlockCleanup = null;
              if (!cancelled && enabledRef.current && activeRef.current) {
                void startPlayback();
              }
            };
            window.addEventListener('pointerdown', onFirstGesture, { passive: true, once: true });
            window.addEventListener('keydown', onFirstGesture, { passive: true, once: true });
            unlockCleanup = () => {
              window.removeEventListener('pointerdown', onFirstGesture);
              window.removeEventListener('keydown', onFirstGesture);
            };
          }
          return;
        }

        const buffer = await loadBgmAudioBuffer(ctx, track.src);
        if (cancelled || !enabledRef.current || !activeRef.current) return;

        stopCurrentSource(false);

        if (activeTrackIdRef.current !== track.id) {
          offsetRef.current = 0;
          activeTrackIdRef.current = track.id;
        }

        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        source.buffer = buffer;
        source.loop = LOBBY_BGM_TRACKS.length === 1;

        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(TARGET_GAIN, now + FADE_IN_SEC);

        source.connect(gain);
        gain.connect(ctx.destination);

        const startOffset = buffer.duration > 0 ? offsetRef.current % buffer.duration : 0;
        startedAtRef.current = now;
        offsetRef.current = startOffset;

        source.onended = () => {
          if (cancelled || sourceRef.current !== source) return;
          sourceRef.current = null;
          gainRef.current = null;
          offsetRef.current = 0;
          if (LOBBY_BGM_TRACKS.length > 1 && enabledRef.current && activeRef.current) {
            writeBgmPrefs({ trackIndex: nextTrackIndex(trackIndex) });
          } else {
            setIsPlaying(false);
          }
        };

        source.start(0, startOffset);
        sourceRef.current = source;
        gainRef.current = gain;
        setIsPlaying(true);
      } catch {
        if (!cancelled) setIsPlaying(false);
      }
    };

    void startPlayback();

    return () => {
      cancelled = true;
      unlockCleanup?.();
      stopCurrentSource(true);
    };
  }, [active, enabled, revision, stopCurrentSource, track.id, track.src, trackIndex]);

  const toggle = useCallback(() => {
    const ctx = getSharedBgmAudioContext();
    if (ctx?.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }
    if (!isPlaying && enabled) {
      setRevision(r => r + 1);
      return;
    }
    writeBgmPrefs({ enabled: !enabled });
  }, [enabled, isPlaying]);

  const next = useCallback(() => {
    const ctx = getSharedBgmAudioContext();
    if (ctx?.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }
    offsetRef.current = 0;
    writeBgmPrefs({ enabled: true, trackIndex: nextTrackIndex(trackIndex) });
    setRevision(r => r + 1);
  }, [trackIndex]);

  const prev = useCallback(() => {
    const ctx = getSharedBgmAudioContext();
    if (ctx?.state === 'suspended') {
      void ctx.resume().catch(() => undefined);
    }
    offsetRef.current = 0;
    writeBgmPrefs({ enabled: true, trackIndex: prevTrackIndex(trackIndex) });
    setRevision(r => r + 1);
  }, [trackIndex]);

  return {
    track,
    trackIndex,
    trackCount: LOBBY_BGM_TRACKS.length,
    enabled,
    isPlaying,
    toggle,
    next,
    prev,
  };
};
