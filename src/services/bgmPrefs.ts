import { normalizeTrackIndex } from './lobbyBgmTracks';

const STORAGE_KEY = 'aiwerewolf:lobby-bgm:v1';

interface StoredBgmPrefs {
  enabled?: boolean;
  trackIndex?: number;
}

export interface BgmPrefsSnapshot {
  enabled: boolean;
  trackIndex: number;
}

const listeners = new Set<(prefs: BgmPrefsSnapshot) => void>();

export const readBgmPrefs = (): BgmPrefsSnapshot => {
  if (typeof window === 'undefined') return { enabled: true, trackIndex: 0 };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { enabled: true, trackIndex: 0 };
    const parsed = JSON.parse(raw) as StoredBgmPrefs;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
      trackIndex: typeof parsed.trackIndex === 'number'
        ? normalizeTrackIndex(parsed.trackIndex)
        : 0,
    };
  } catch {
    return { enabled: true, trackIndex: 0 };
  }
};

export const writeBgmPrefs = (next: Partial<BgmPrefsSnapshot>): BgmPrefsSnapshot => {
  const current = readBgmPrefs();
  const merged: BgmPrefsSnapshot = {
    enabled: typeof next.enabled === 'boolean' ? next.enabled : current.enabled,
    trackIndex: typeof next.trackIndex === 'number' ? normalizeTrackIndex(next.trackIndex) : current.trackIndex,
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Storage is optional in restricted browser profiles.
    }
  }
  for (const listener of listeners) {
    listener(merged);
  }
  return merged;
};

export const subscribeBgmPrefs = (listener: (prefs: BgmPrefsSnapshot) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

let sharedAudioContext: AudioContext | null = null;
const rawBytesCache = new Map<string, Promise<ArrayBuffer>>();
const decodedBufferCache = new Map<string, Promise<AudioBuffer>>();

export const getSharedBgmAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const win = window as Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? win.webkitAudioContext ?? null;
  if (!Ctor) return null;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new Ctor();
  }
  return sharedAudioContext;
};

export const fetchBgmBytes = (src: string): Promise<ArrayBuffer> => {
  const existing = rawBytesCache.get(src);
  if (existing) return existing;
  const pending = fetch(src).then(res => {
    if (!res.ok) throw new Error(`BGM fetch failed: ${res.status}`);
    return res.arrayBuffer();
  }).catch(err => {
    rawBytesCache.delete(src);
    throw err;
  });
  rawBytesCache.set(src, pending);
  return pending;
};

export const loadBgmAudioBuffer = (ctx: AudioContext, src: string): Promise<AudioBuffer> => {
  const existing = decodedBufferCache.get(src);
  if (existing) return existing;
  const pending = fetchBgmBytes(src)
    .then(bytes => ctx.decodeAudioData(bytes.slice(0)))
    .catch(err => {
      decodedBufferCache.delete(src);
      throw err;
    });
  decodedBufferCache.set(src, pending);
  return pending;
};
