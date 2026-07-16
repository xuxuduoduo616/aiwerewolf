/**
 * i18n — display-language state for the UI layer.
 *
 * The game keeps bilingual log fields (`message` = English, `translation` =
 * Chinese; see GameLog in src/types.ts). This module only decides which field
 * to SHOW — it never touches game state.
 */
import { useCallback, useState } from 'react';
import type { GameLog } from '../types';

export type DisplayLanguage = 'zh' | 'en';

export const DEFAULT_DISPLAY_LANGUAGE: DisplayLanguage = 'zh';
export const LANGUAGE_STORAGE_KEY = 'werewolf_display_language';

export const isDisplayLanguage = (value: unknown): value is DisplayLanguage =>
  value === 'zh' || value === 'en';

export const nextDisplayLanguage = (language: DisplayLanguage): DisplayLanguage =>
  language === 'zh' ? 'en' : 'zh';

export const loadDisplayLanguage = (): DisplayLanguage => {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isDisplayLanguage(stored) ? stored : DEFAULT_DISPLAY_LANGUAGE;
  } catch {
    return DEFAULT_DISPLAY_LANGUAGE;
  }
};

export const saveDisplayLanguage = (language: DisplayLanguage): void => {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // localStorage unavailable (private mode / SSR) — language stays in memory.
  }
};

/**
 * Pick the log text matching the display language from the existing bilingual
 * fields. `message` is English, `translation` is Chinese by convention.
 */
export const pickLogText = (
  log: Pick<GameLog, 'message' | 'translation'>,
  language: DisplayLanguage,
): string => {
  if (language === 'zh') return log.translation || log.message;
  return log.message || log.translation || '';
};

/**
 * Canned English stubs the local AI fallback writes into the `message` field
 * when no real English speech exists (src/ai/aiOrchestrator.ts). Exact known
 * strings only — genuine English speech must never match.
 */
const CANNED_EN_STUBS: RegExp[] = [
  /^Speaks based on game situation\.$/,
  /^Frames Player (\d+|\?)\.$/,
  /^Pushes suspicion on Player (\d+|\?)\.$/,
  /^Seer reports: Player \d+ is (GOOD|WOLF)\.$/,
];

export const isCannedEnglishStub = (text: string): boolean =>
  CANNED_EN_STUBS.some(pattern => pattern.test(text.trim()));

/**
 * Pick the text a translation request should start from. Normally this is the
 * display text itself (pickLogText); in EN mode, when a speech entry's English
 * field is missing or a known canned fallback stub while a Chinese original
 * exists, the zh original carries the real content and becomes the source.
 */
export const pickTranslationSource = (
  log: Pick<GameLog, 'message' | 'translation' | 'isSystem'>,
  language: DisplayLanguage,
): string => {
  if (
    language === 'en' &&
    !log.isSystem &&
    log.translation &&
    (!log.message || isCannedEnglishStub(log.message))
  ) {
    return log.translation;
  }
  return pickLogText(log, language);
};

/** Display-language state, persisted to localStorage across reloads. */
export const useDisplayLanguage = (): [DisplayLanguage, () => void] => {
  const [language, setLanguage] = useState<DisplayLanguage>(loadDisplayLanguage);
  const toggleLanguage = useCallback(() => {
    setLanguage(previous => {
      const next = nextDisplayLanguage(previous);
      saveDisplayLanguage(next);
      return next;
    });
  }, []);
  return [language, toggleLanguage];
};
