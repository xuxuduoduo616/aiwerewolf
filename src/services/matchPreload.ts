import { preloadSpeechPools } from './speechLibrary';

interface PreloadablePlayer {
  role: string;
  avatarUrl?: string;
}

const preloadImage = (url: string): Promise<void> => new Promise(resolve => {
  if (typeof Image === 'undefined') { resolve(); return; }
  const image = new Image();
  image.onload = () => resolve();
  image.onerror = () => resolve();
  image.decoding = 'async';
  image.src = url;
});

/**
 * Everything the first minute of a match needs: speech pools for the dealt
 * roles and every seat avatar. Never rejects; slow assets are capped by the
 * caller's timeout so the ceremony can always finish.
 */
export const preloadMatchAssets = async (players: readonly PreloadablePlayer[]): Promise<void> => {
  const avatars = [...new Set(players.map(player => player.avatarUrl).filter((url): url is string => Boolean(url)))];
  await Promise.all([
    preloadSpeechPools(players.map(player => player.role)).catch(() => undefined),
    ...avatars.map(preloadImage),
  ]);
};

/** Resolves when `work` settles or after `ms`, whichever comes first. */
export const settleWithin = (work: Promise<unknown>, ms: number): Promise<void> => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  work.then(
    () => { clearTimeout(timer); resolve(); },
    () => { clearTimeout(timer); resolve(); },
  );
});
