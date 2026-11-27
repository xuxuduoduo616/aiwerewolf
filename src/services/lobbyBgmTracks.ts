export interface BgmTrack {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly src: string;
}

/**
 * Extensible Jianghu instrumental soundtrack registry for the Lobby shell.
 * Add future Guzheng / Piano / Xiao tracks here after mastering via
 * `python3 scripts/build-bgm-media.py`.
 */
export const LOBBY_BGM_TRACKS: readonly BgmTrack[] = [
  {
    id: 'red-dust-inn',
    title: 'Red Dust Inn',
    subtitle: 'Jianghu Instrumental',
    src: '/assets/bgm/hongchen-kezhan.mp3',
  },
] as const;

export const normalizeTrackIndex = (index: number, count = LOBBY_BGM_TRACKS.length): number => {
  if (count <= 0) return 0;
  return ((Math.trunc(index) % count) + count) % count;
};

export const nextTrackIndex = (current: number, count = LOBBY_BGM_TRACKS.length): number =>
  normalizeTrackIndex(current + 1, count);

export const prevTrackIndex = (current: number, count = LOBBY_BGM_TRACKS.length): number =>
  normalizeTrackIndex(current - 1, count);
