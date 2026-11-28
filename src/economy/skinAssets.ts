export const WUXIA_SKIN_IDS = [
  'mist-wanderer',
  'bamboo-vigil',
  'tidal-swordsman',
  'moonlit-crane',
  'jade-moon-oath',
  'tidebreaker-vow',
  'crimson-lotus-shadow',
] as const;

export type WuxiaSkinId = (typeof WUXIA_SKIN_IDS)[number];

const WUXIA_SKIN_ID_SET: ReadonlySet<string> = new Set(WUXIA_SKIN_IDS);

export const isWuxiaSkinId = (id: string): boolean => WUXIA_SKIN_ID_SET.has(id);

export const DEFAULT_OUTFIT_SPEC = {
  id: 'default',
  name: 'Default Outfit',
  subtitle: 'Lone Jianghu Wanderer',
  description: 'Your original Jianghu wanderer in a bamboo hat. Always included in your collection.',
  accent: '#8e8a80',
} as const;

export const AI_AVATAR_COUNT = 12;

export const AI_AVATAR_URLS = Array.from(
  { length: AI_AVATAR_COUNT },
  (_, index) => `/assets/avatars/ai-${String(index + 1).padStart(2, '0')}.webp`,
) as readonly string[];

export const getSkinPortraitUrl = (skinId?: string | null): string =>
  `/assets/skins/${skinId && isWuxiaSkinId(skinId) ? skinId : 'default'}/portrait.webp`;

export const getSkinAvatarUrl = (skinId?: string | null): string =>
  `/assets/skins/${skinId && isWuxiaSkinId(skinId) ? skinId : 'default'}/avatar.webp`;

export const getAiAvatarUrl = (seatZeroBasedIndex: number): string =>
  AI_AVATAR_URLS[((seatZeroBasedIndex % AI_AVATAR_COUNT) + AI_AVATAR_COUNT) % AI_AVATAR_COUNT];
