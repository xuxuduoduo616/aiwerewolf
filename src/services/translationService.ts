/**
 * translationService — display-layer AI translation for game log speeches.
 *
 * Speech library entries come from the AIWolf corpus and are mixed EN/JA/CN,
 * so AI speeches may appear in a language that does not match the selected
 * display language (frequently Japanese). This service detects mismatches and
 * translates them through the server proxy — never blocking game flow: on any
 * failure (or in local Vite dev, where the proxy does not run) the original
 * text is returned unchanged.
 *
 * Display layer ONLY. Game state, votes, roles, and log ordering are never
 * touched.
 */
import type { DisplayLanguage } from '../i18n';

/**
 * Single endpoint-path constant for translation requests. Swap this one line
 * when the provider-adapter endpoint replaces the Netlify proxy.
 */
export const TRANSLATION_ENDPOINT = '/.netlify/functions/genai-proxy';

export type DetectedLanguage = 'zh' | 'en' | 'ja' | 'unknown';

// Same local-dev guard as src/ai/geminiAdapter.ts (not exported there).
const isLocalVite = (): boolean => {
  if (typeof window === 'undefined') return false;
  return new Set(['5173', '4173', '4174', '4175']).has(window.location.port);
};

/**
 * Heuristic language detection:
 * - any Japanese kana (hiragana/katakana) → 'ja' (distinguishes ja from zh,
 *   since Japanese also uses CJK ideographs)
 * - CJK-ideograph-dominant → 'zh'
 * - ASCII-dominant → 'en'
 * - otherwise (empty, CJK-punctuation-only, or heavily mixed) → 'unknown'
 */
export const detectLanguage = (text: string): DetectedLanguage => {
  let kana = 0;
  let cjk = 0;
  let ascii = 0;
  let counted = 0;

  for (const char of text) {
    if (/\s/.test(char)) continue;
    const code = char.codePointAt(0) as number;
    counted += 1;
    if ((code >= 0x3040 && code <= 0x30ff) || (code >= 0x31f0 && code <= 0x31ff)) {
      kana += 1; // hiragana, katakana, katakana phonetic extensions
    } else if (code >= 0x4e00 && code <= 0x9fff) {
      cjk += 1; // CJK unified ideographs
    } else if (code >= 0x21 && code <= 0x7e) {
      ascii += 1; // printable ASCII
    }
  }

  if (counted === 0) return 'unknown';
  if (kana > 0) return 'ja';
  if (cjk / counted >= 0.3) return 'zh';
  if (ascii / counted >= 0.7) return 'en';
  return 'unknown';
};

/**
 * True when the text's detected language mismatches the display language.
 * 'unknown' never triggers translation (fail-safe: show as-is).
 */
export const needsTranslation = (text: string, language: DisplayLanguage): boolean => {
  const detected = detectLanguage(text);
  return detected !== 'unknown' && detected !== language;
};

// Cache by log-entry id (+ target language) — an entry is requested at most
// once per target language. Failures cache the original text so a failing
// proxy is never hammered by re-renders.
const translationCache = new Map<string, string>();
const pendingTranslations = new Map<string, Promise<string>>();

/** Test hook: reset module-level caches. */
export const clearTranslationCache = (): void => {
  translationCache.clear();
  pendingTranslations.clear();
};

const requestTranslation = async (text: string, language: DisplayLanguage): Promise<string> => {
  const target = language === 'zh' ? 'Simplified Chinese' : 'English';
  const response = await fetch(TRANSLATION_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      prompt: `Translate the following Werewolf (social deduction game) speech into ${target}. Keep the tone conversational and keep player references (e.g. "3号" / "Player 3") natural in the target language. Output ONLY the translation, nothing else.\n\n${text}`,
      temperature: 0.2,
    }),
  });
  if (!response.ok) return '';
  const json = await response.json();
  return typeof json.text === 'string' ? json.text.trim() : '';
};

/**
 * Translate a log entry's text into the display language.
 * Returns the original text when no translation is needed, in local Vite dev,
 * or on any failure — never throws, never blocks rendering.
 */
export const translateLogText = (
  logId: string,
  text: string,
  language: DisplayLanguage,
): Promise<string> => {
  if (!text || !needsTranslation(text, language)) return Promise.resolve(text);

  const cacheKey = `${logId}:${language}`;
  const cached = translationCache.get(cacheKey);
  if (cached !== undefined) return Promise.resolve(cached);

  const pending = pendingTranslations.get(cacheKey);
  if (pending) return pending;

  if (isLocalVite()) return Promise.resolve(text); // proxy not available locally

  const task = requestTranslation(text, language)
    .then(translated => translated || text)
    .catch(() => text)
    .then(result => {
      translationCache.set(cacheKey, result);
      pendingTranslations.delete(cacheKey);
      return result;
    });
  pendingTranslations.set(cacheKey, task);
  return task;
};
