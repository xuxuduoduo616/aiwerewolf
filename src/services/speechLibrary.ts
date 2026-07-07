/**
 * Speech library: distilled from aiwolf-nlp-viewer contest logs.
 * 111 games, 11,449 speeches scraped from aiwolfdial GitHub.
 *
 * Usage: pickSpeech(role, tags?, round?) → { text, tags }
 */

import type { Role } from '../types';

const isChineseText = (text: string): boolean => {
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  return cjk / Math.max(1, text.length) > 0.3;
};

export interface SpeechEntry {
  text: string;
  role: string;
  day: number;
  tags: string[];
}

// Lazy-loaded speech pools per role
const pools: Partial<Record<string, SpeechEntry[]>> = {};

const ROLE_FILE_MAP: Record<string, string> = {
  Werewolf:  'werewolf',
  Villager:  'villager',
  Seer:      'seer',
  Witch:     'seer',      // fallback to seer pool (closest behavior)
  Hunter:    'villager',  // fallback to villager pool
  Idiot:     'villager',  // fallback to villager pool
};

async function loadPool(role: string): Promise<SpeechEntry[]> {
  const key = ROLE_FILE_MAP[role] || 'villager';
  if (pools[key]) return pools[key]!;

  try {
    // Dynamic import of JSON data files
    const module = await import(`../data/${key}_speeches.json`);
    pools[key] = module.default as SpeechEntry[];
  } catch {
    pools[key] = [];
  }
  return pools[key]!;
}

/**
 * Pick a random speech from the library.
 * Falls back to empty string if no Chinese match found.
 */
export async function pickSpeech(
  role: Role,
  preferTags: string[] = [],
  round = 1,
): Promise<string> {
  const entries = await loadPool(role as string);
  if (entries.length === 0) return '';

  // Filter by day proximity (round maps to aiwolf day)
  const dayRange = [Math.max(0, round - 1), round + 1];
  const dayMatched = entries.filter(e => e.day >= dayRange[0] && e.day <= dayRange[1]);
  const pool = dayMatched.length >= 5 ? dayMatched : entries;

  // Only allow Chinese entries (since aiwolf corpus is mixed EN/JA/CN)
  const chineseEntries = pool.filter(e => isChineseText(e.text));
  const finalPool = chineseEntries.length >= 3 ? chineseEntries : pool;

  // Try to find an entry with preferred tags
  if (preferTags.length > 0) {
    const tagged = finalPool.filter(e => preferTags.some(t => e.tags.includes(t)));
    if (tagged.length > 0) {
      return tagged[Math.floor(Math.random() * tagged.length)].text;
    }
  }

  return finalPool[Math.floor(Math.random() * finalPool.length)].text;
}

/**
 * Pick a speech for wolf night chat (from whisper logs if available).
 */
export async function pickWolfNightSpeech(): Promise<string> {
  return pickSpeech('Werewolf' as Role, ['wolf_night_chat', 'wolf_day_speech'], 0);
}

/**
 * Pick a seer reporting speech.
 */
export async function pickSeerReportSpeech(round: number): Promise<string> {
  return pickSpeech('Seer' as Role, ['seer_speech', 'seer_related'], round);
}

/**
 * Get multiple diverse speeches (for wolf chat options).
 */
export async function pickMultipleSpeches(
  role: Role,
  count: number,
  round = 1,
): Promise<string[]> {
  const entries = await loadPool(role as string);
  if (entries.length === 0) return [];

  const shuffled = [...entries].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(e => e.text);
}
