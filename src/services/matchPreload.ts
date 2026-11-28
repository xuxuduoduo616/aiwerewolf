import type { Role } from '../types';
import { getSkinAvatarUrl } from '../economy/skinAssets';
import { getRoleShowcaseSpec } from './roleShowcaseConfig';
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
 * roles, every seat avatar, and only the human player's role showcase portrait
 * (never all six role videos). Never rejects; slow assets are capped by the
 * caller's timeout so the ceremony can always finish.
 */
export const preloadMatchAssets = async (
  players: readonly PreloadablePlayer[],
  humanRole?: Role,
  equippedSkinId?: string | null,
): Promise<void> => {
  const seatAvatars = players.map(player => player.avatarUrl).filter((url): url is string => Boolean(url));
  const skinAvatarUrl = equippedSkinId !== undefined ? getSkinAvatarUrl(equippedSkinId) : null;
  const avatars = [...new Set(skinAvatarUrl ? [...seatAvatars, skinAvatarUrl] : seatAvatars)];
  const portraitUrl = humanRole ? getRoleShowcaseSpec(humanRole).portraitSrc : null;
  const imageUrls = portraitUrl && !avatars.includes(portraitUrl)
    ? [...avatars, portraitUrl]
    : avatars;

  await Promise.all([
    preloadSpeechPools(players.map(player => player.role)).catch(() => undefined),
    ...imageUrls.map(preloadImage),
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
