export type EconomyCurrency = 'coins' | 'crystals';

export type SkinTier = 'Basic' | 'Premium';

export interface SkinProduct {
  id: string;
  name: string;
  tier: SkinTier;
  currency: EconomyCurrency;
  price: number;
  season: 'core' | 'tidal';
  description: string;
  prompt: string;
  accent: string;
  mark: 'mountain' | 'bamboo' | 'wave' | 'moon' | 'crane' | 'sword' | 'lotus';
}

/**
 * Version-one cosmetic catalog. Prices are part of the guest ledger schema:
 * changing an existing product price requires a new ledger version.
 */
export const SKIN_CATALOG = [
  {
    id: 'mist-wanderer',
    name: 'Mist Wanderer',
    tier: 'Basic',
    currency: 'coins',
    price: 800,
    season: 'core',
    description: 'A charcoal travel robe edged with quiet mountain mist.',
    prompt: 'Original wuxia traveler, layered charcoal hanfu, pale mountain mist, dry-brush ink wash, handmade rice paper texture, no text, monochrome with muted jade accent.',
    accent: '#8fa99a',
    mark: 'mountain',
  },
  {
    id: 'bamboo-vigil',
    name: 'Bamboo Vigil',
    tier: 'Basic',
    currency: 'coins',
    price: 1400,
    season: 'core',
    description: 'A disciplined guard silhouette beneath wind-bent bamboo.',
    prompt: 'Original wuxia night guard, black linen robes, bamboo grove in wind, expressive sumi-e strokes, rice paper grain, no text, monochrome with restrained moss accent.',
    accent: '#748b65',
    mark: 'bamboo',
  },
  {
    id: 'tidal-swordsman',
    name: 'Tidal Swordsman',
    tier: 'Basic',
    currency: 'coins',
    price: 2200,
    season: 'tidal',
    description: 'Salt-blue hems and a blade traced by a single rising tide.',
    prompt: 'Original wuxia swordsman on a moonlit shore, robe hem becoming an ink wave, bold black wash, rice paper texture, no text, monochrome with limited desaturated blue accent.',
    accent: '#6d93a8',
    mark: 'wave',
  },
  {
    id: 'moonlit-crane',
    name: 'Moonlit Crane',
    tier: 'Basic',
    currency: 'coins',
    price: 3200,
    season: 'tidal',
    description: 'Long white sleeves echo a crane crossing the moon.',
    prompt: 'Original wuxia scholar-warrior, flowing white and charcoal robes, crane crossing a pale moon, delicate ink wash and dry brush, no text, muted silver accent.',
    accent: '#b6b9c3',
    mark: 'crane',
  },
  {
    id: 'jade-moon-oath',
    name: 'Jade Moon Oath',
    tier: 'Premium',
    currency: 'crystals',
    price: 20,
    season: 'core',
    description: 'A ceremonial moon clasp glows against layered ink-black silk.',
    prompt: 'Original premium wuxia ceremonial robe, ink-black silk, small jade moon clasp, misty mountain negative space, hand-painted ink wash, no text, limited jade glow.',
    accent: '#6fb69b',
    mark: 'moon',
  },
  {
    id: 'tidebreaker-vow',
    name: 'Tidebreaker Vow',
    tier: 'Premium',
    currency: 'crystals',
    price: 40,
    season: 'tidal',
    description: 'Foam-white sword strokes break across an indigo ink sea.',
    prompt: 'Original premium wuxia blade master, storm coast, sword stroke splitting an ink wave, black and white rice-paper painting, no text, limited indigo and pearl accents.',
    accent: '#668db4',
    mark: 'sword',
  },
  {
    id: 'crimson-lotus-shadow',
    name: 'Crimson Lotus Shadow',
    tier: 'Premium',
    currency: 'crystals',
    price: 80,
    season: 'tidal',
    description: 'A lone vermilion lotus marks an otherwise monochrome assassin.',
    prompt: 'Original premium wuxia shadow assassin, layered monochrome robes, floating ink lotus petals, expressive brush splatter, rice paper grain, no text, one restrained vermilion accent.',
    accent: '#a94f4f',
    mark: 'lotus',
  },
] as const satisfies readonly SkinProduct[];

export const SKIN_CATALOG_BY_ID = new Map<string, SkinProduct>(
  SKIN_CATALOG.map(product => [product.id, product]),
);

export const BASIC_SKIN_PRICES = [800, 1400, 2200, 3200] as const;
export const PREMIUM_SKIN_PRICES = [20, 40, 80] as const;

/** Day-60 check-in cosmetic. It is owned through the milestone, not purchased. */
export const DAY_60_BASIC_SKIN_ID = 'mist-wanderer';
