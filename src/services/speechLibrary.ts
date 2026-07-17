/**
 * Speech library: distilled from aiwolf-nlp-viewer contest logs.
 * 111 games, 11,449 speeches scraped from aiwolfdial GitHub.
 *
 * Usage: pickSpeech(role, tags?, round?) → { text, tags }
 */

import { Role } from '../types';
import type { DisplayLanguage } from '../i18n';

const isChineseText = (text: string): boolean => {
  const cjk = (text.match(/[一-鿿㐀-䶿]/g) || []).length;
  return cjk / Math.max(1, text.length) > 0.3;
};

const isEnglishText = (text: string): boolean => {
  const cjkOrKana = (text.match(/[一-鿿㐀-䶿ぁ-ゟ゠-ヿ]/g) || []).length;
  return cjkOrKana === 0 && /[a-zA-Z]/.test(text);
};

const matchesDisplayLanguage = (text: string, language: DisplayLanguage): boolean =>
  language === 'en' ? isEnglishText(text) : isChineseText(text);

/**
 * Self-reveal patterns that leak a wolf-team speaker's hidden role in public
 * speech (aiwolf corpus is JA/ZH/EN mixed). The possessed/狂人 is wolf-team in
 * the source corpus, so its self-reveals also leak wolf-side alignment.
 * Seer claims (预言家/占い師/"I am the seer") are a legitimate strategy — even
 * a wolf fake-claiming seer — and are intentionally NOT matched here.
 * Negations like 「私は人狼ではない」/「我不是狼人」/"I am not a werewolf"
 * are legitimate defenses and must not match.
 */
const WOLF_SELF_REVEAL_PATTERNS: ReadonlyArray<RegExp> = [
  /(私|僕|俺|わたし|あたし)[はがも]?人狼(?!では|じゃ|であり|ではあり)/,
  /我(就|们|們)?是狼(人)?/,
  /\bI\s*(?:am|'m)\s+(?:a\s+|the\s+)?werewolf\b/i,
  /(私|僕|俺|わたし|あたし)[はがも]?狂人(?!では|じゃ|であり|ではあり)/,
  /我(就|们|們)?是狂人/,
  /\bI\s*(?:am|'m)\s+(?:the\s+|a\s+)?possessed\b/i,
];

/**
 * True when picking `text` for a speaker of `role` would self-reveal the
 * speaker's hidden role in day/discussion speech.
 */
export const revealsHiddenRole = (text: string, role: Role): boolean =>
  role === Role.WEREWOLF && WOLF_SELF_REVEAL_PATTERNS.some(p => p.test(text));

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

export interface PickSpeechOptions {
  /** Preferred display language for the pick. Defaults to 'zh'. */
  language?: DisplayLanguage;
  /**
   * Exclude entries that self-reveal the speaker's hidden role.
   * Defaults to true (day/discussion picks); wolf night chat disables it
   * because wolves self-identifying among teammates is fine by design.
   */
  filterSelfReveal?: boolean;
}

/**
 * Pure pick over a given entry pool (exported for unit tests with crafted
 * pools). Same selection pipeline as pickSpeech: leakage filter → day
 * proximity → language preference → preferred tags → random.
 */
export function pickSpeechFromEntries(
  entries: SpeechEntry[],
  role: Role,
  preferTags: string[] = [],
  round = 1,
  options: PickSpeechOptions = {},
): string {
  const { language = 'zh', filterSelfReveal = true } = options;
  if (entries.length === 0) return '';

  // Leakage filter is absolute: a self-revealing entry must never be picked,
  // so it applies before every fallback. Degenerate all-leaking pools return
  // '' — callers already fall back on empty picks.
  const safeEntries = filterSelfReveal
    ? entries.filter(e => !revealsHiddenRole(e.text, role))
    : entries;
  if (safeEntries.length === 0) return '';

  // Filter by day proximity (round maps to aiwolf day)
  const dayRange = [Math.max(0, round - 1), round + 1];
  const dayMatched = safeEntries.filter(e => e.day >= dayRange[0] && e.day <= dayRange[1]);
  const pool = dayMatched.length >= 5 ? dayMatched : safeEntries;

  // Prefer display-language entries (aiwolf corpus is mixed EN/JA/CN),
  // falling back to the mixed pool when too few match.
  const languageMatched = pool.filter(e => matchesDisplayLanguage(e.text, language));
  const finalPool = languageMatched.length >= 3 ? languageMatched : pool;

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
 * Pick a random speech from the library.
 * Returns '' only when the pool is empty (or fully excluded by the
 * self-reveal filter) — callers already fall back on empty picks.
 */
export async function pickSpeech(
  role: Role,
  preferTags: string[] = [],
  round = 1,
  options: PickSpeechOptions = {},
): Promise<string> {
  const entries = await loadPool(role as string);
  return pickSpeechFromEntries(entries, role, preferTags, round, options);
}

/**
 * Pick a speech for wolf night chat (from whisper logs if available).
 * Night chat is wolf-team-internal, so the self-reveal filter is off.
 */
export async function pickWolfNightSpeech(language: DisplayLanguage = 'zh'): Promise<string> {
  return pickSpeech(Role.WEREWOLF, ['wolf_night_chat', 'wolf_day_speech'], 0, {
    filterSelfReveal: false,
    language,
  });
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
