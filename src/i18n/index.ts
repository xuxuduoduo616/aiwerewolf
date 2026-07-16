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
