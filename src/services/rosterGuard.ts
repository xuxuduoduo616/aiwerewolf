/**
 * rosterGuard — final-boundary roster check for every displayed AI speech
 * (card: ai-speech-roster-name-fix, H8 output guard + H2 prompt hygiene +
 * H5 translation referent protection).
 *
 * Reuses the detection logic of the accepted diagnosis harness
 * (src/diagnostics/nameDetector.ts) by importing it — the guard and the audit
 * therefore always agree on what counts as an out-of-roster reference.
 *
 * Guarantees:
 *   - a foreign name is NEVER mapped onto a real playerId/seat — repair only
 *     substitutes seat-neutral placeholders or drops a contradicting name
 *     while keeping its structural seat reference;
 *   - detected-bad text never reaches the display path: callers either use
 *     the repaired text (`ok === true`) or fall through to the next layer /
 *     the nameless fallback line, which contains no player reference at all.
 */

import type { Player } from '../types';
import type { DisplayLanguage } from '../i18n';
import { AI_NAMES } from '../constants';
import {
  AGENT_REF_RE,
  detectNameViolations,
  extractSeatRefs,
  type NameViolation,
} from '../diagnostics/nameDetector';
import entities from '../diagnostics/aiwolf-entities.json';

// ─── entity patterns (same boundary rules as the detector; the katakana
// matcher additionally absorbs a trailing honorific so 「サクラさん」 repairs
// to a bare placeholder) ─────────────────────────────────────────────────────

const latinNamePatterns: ReadonlyArray<{ name: string; re: RegExp }> = entities.latinNames.map(
  name => ({ name, re: new RegExp(`(?<![A-Za-z])${name}(?![a-z])`, 'g') }),
);

const katakanaNamePatterns: ReadonlyArray<{ name: string; re: RegExp }> = entities.katakanaNames.map(
  name => ({ name, re: new RegExp(`(?<![ァ-ヶー])${name}(?:さん|くん|ちゃん|君|氏)?(?![ァ-ヶー])`, 'g') }),
);

const productNamePatterns: ReadonlyArray<{ name: string; re: RegExp }> = AI_NAMES.map(
  name => ({ name, re: new RegExp(`(?<![A-Za-z])${name}(?![a-z])`, 'g') }),
);

const PLACEHOLDERS: Record<DisplayLanguage, [string, string]> = {
  zh: ['那位玩家', '另一位玩家'],
  en: ['that player', 'the other player'],
};

const PROMPT_PLACEHOLDER: Record<DisplayLanguage, string> = {
  zh: '某玩家',
  en: 'another player',
};

/** Nameless safe fallback lines — no player reference by construction. */
const NAMELESS_FALLBACK: Record<DisplayLanguage, string> = {
  zh: '这一轮我先多听大家的发言，把票型和逻辑盘清楚之后再给出我的判断。',
  en: 'I will hold my read for now and listen carefully to what everyone says this round before committing my vote anywhere.',
};

export const namelessFallbackLine = (language: DisplayLanguage): string =>
  NAMELESS_FALLBACK[language];

// ─── prompt hygiene (H2) ─────────────────────────────────────────────────────

/**
 * Strip known foreign entities (raw `Agent[XX]` refs + AIWolf corpus names)
 * from text that flows into LLM prompts (historical log lines), so pre-fix
 * pollution can never recycle into new model output. Roster names are safe:
 * the product AI name list is disjoint from the AIWolf entity list.
 */
export const sanitizeForeignEntities = (
  text: string,
  language: DisplayLanguage = 'zh',
): string => {
  if (!text) return text;
  const placeholder = PROMPT_PLACEHOLDER[language];
  let out = text.replace(AGENT_REF_RE, placeholder);
  for (const { re } of [...latinNamePatterns, ...katakanaNamePatterns]) {
    out = out.replace(re, placeholder);
  }
  return out;
};

// ─── output guard (H8) ───────────────────────────────────────────────────────

export interface GuardResult {
  /** True when `text` is safe to display (possibly after repair). */
  ok: boolean;
  /** The safe text when ok; the original text when not repairable. */
  text: string;
  /** True when a structural repair was applied. */
  repaired: boolean;
  /** Violations found in the original text (empty when it was clean). */
  violations: NameViolation[];
}

/**
 * Structural repair: replace every out-of-roster reference with a
 * seat-neutral placeholder (first/second distinct entity get distinct
 * placeholders so short sentences stay coherent), and resolve
 * roster-contradicting "N号 Name" pairs by keeping the structural seat
 * reference and dropping the name. Never guesses a playerId.
 */
const repairText = (text: string, roster: Player[], language: DisplayLanguage): string => {
  const rosterIds = new Set(roster.map(p => p.id));
  const rosterNames = new Set(roster.map(p => p.name));
  const placeholders = PLACEHOLDERS[language];
  const placeholderIndex = new Map<string, number>();
  const placeholderFor = (key: string): string => {
    if (!placeholderIndex.has(key)) placeholderIndex.set(key, placeholderIndex.size);
    return placeholders[Math.min(placeholderIndex.get(key)!, placeholders.length - 1)];
  };

  let out = text;

  // 1) "N号 Name" / "Player N Name" pairs contradicting the roster → keep the
  //    seat (structural reference, unambiguous), drop the name.
  out = out
    .replace(/(\d{1,2})\s*号\s+([A-Z][A-Za-z]+)/g, (m, seat: string, name: string) => {
      if (!rosterNames.has(name)) return m; // foreign names handled below
      const player = roster.find(p => p.id === Number(seat));
      return player && player.name === name ? m : `${seat}号`;
    })
    .replace(/Player\s*(\d{1,2})\s+([A-Z][A-Za-z]+)/g, (m, seat: string, name: string) => {
      if (!rosterNames.has(name)) return m;
      const player = roster.find(p => p.id === Number(seat));
      return player && player.name === name ? m : `Player ${seat}`;
    });

  // 2) Raw AIWolf agent references → neutral placeholder (never a seat).
  out = out.replace(AGENT_REF_RE, m => placeholderFor(m.replace(/\s+/g, '')));

  // 3) Known AIWolf corpus names → neutral placeholder.
  for (const { name, re } of [...latinNamePatterns, ...katakanaNamePatterns]) {
    if (rosterNames.has(name)) continue;
    out = out.replace(re, () => placeholderFor(name));
  }

  // 4) Product AI names not seated in this game → neutral placeholder.
  for (const { name, re } of productNamePatterns) {
    if (rosterNames.has(name)) continue;
    out = out.replace(re, () => placeholderFor(name));
  }

  // 5) Seat references outside the roster → neutral placeholder.
  out = out
    .replace(/(\d{1,2})\s*号/g, (m, seat: string) =>
      rosterIds.has(Number(seat)) ? m : placeholderFor(`seat-${seat}`))
    .replace(/Player\s*(\d{1,2})/gi, (m, seat: string) =>
      rosterIds.has(Number(seat)) ? m : placeholderFor(`seat-${seat}`));

  return out;
};

/**
 * Final-boundary check for a displayed speech text. Clean text passes
 * through; polluted text gets a structural repair verified against the
 * detector; unrepairable text returns `ok: false` — the caller must fall
 * through to the next layer or use `namelessFallbackLine`.
 */
export const guardSpeechText = (
  text: string,
  roster: Player[],
  language: DisplayLanguage = 'zh',
): GuardResult => {
  const violations = detectNameViolations(text, roster);
  if (violations.length === 0) return { ok: true, text, repaired: false, violations };

  const repaired = repairText(text, roster, language);
  if (detectNameViolations(repaired, roster).length === 0) {
    return { ok: true, text: repaired, repaired: true, violations };
  }
  return { ok: false, text, repaired: false, violations };
};

// ─── translation referent protection (H5) ────────────────────────────────────

/** Seat numbers referenced by a text (re-exported for the translation flow). */
export { extractSeatRefs } from '../diagnostics/nameDetector';

/**
 * True when a translation introduces a player referent absent from its
 * source: a new seat number, a known AIWolf entity, or a product AI name.
 * Checked without a roster (the display-layer call site has none): any
 * introduced entity is drift regardless of roster. Dropped referents are NOT
 * flagged — the existing service contract (see translationService tests)
 * accepts summarizing translations, and a dropped seat cannot point at a
 * wrong player. Callers fall back to the original text on violation.
 */
export const translationViolatesReferents = (
  original: string,
  translated: string,
): boolean => {
  const srcSeats = new Set(extractSeatRefs(original));
  for (const seat of extractSeatRefs(translated)) {
    if (!srcSeats.has(seat)) return true;
  }
  for (const violation of detectNameViolations(translated, [])) {
    if (!original.includes(violation.match)) return true;
  }
  return false;
};

// ─── dev-only diagnostics (fix invariant 8) ──────────────────────────────────

export interface SpeechDiagnosticMeta {
  context: 'day-speech' | 'wolf-chat' | 'vote-reason';
  source: 'remote-model' | 'library' | 'hardcoded-fallback' | 'nameless-fallback';
  /** Model route for remote-model sources (no keys, no prompts). */
  model?: string;
  speakerId?: number;
  repaired?: boolean;
  fallbackReason?: string;
}

/** Dev-console-only gate: enabled in `vite dev`, never in tests or builds. */
export const speechDiagnosticsEnabled = (): boolean =>
  Boolean(import.meta.env?.DEV) && import.meta.env?.MODE !== 'test';

/**
 * Dev-only diagnostic metadata for generated speeches. Console-only, never
 * player-visible, no secrets (the meta shape carries no prompts or keys).
 */
export const emitSpeechDiagnostic = (meta: SpeechDiagnosticMeta): void => {
  if (!speechDiagnosticsEnabled()) return;
  console.debug('[speech-diagnostic]', meta);
};
