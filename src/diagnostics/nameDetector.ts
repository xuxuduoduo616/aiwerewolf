/**
 * Diagnostics — roster/name reference detector for AI speech texts.
 *
 * DIAGNOSIS ONLY (card: ai-speech-name-detection-harness). Nothing here is
 * imported by product code. Pure functions: given a text and the current
 * game roster, report every reference that is not a valid, correctly-mapped
 * reference to a current-roster player:
 *
 *   - `Agent[XX]`               → raw AIWolf-contest entity (agent-ref)
 *   - known AIWolf personal name → corpus leftover (aiwolf-name)
 *   - seat number outside roster → out-of-roster-seat (e.g. 10号 in a 9p game)
 *   - product AI name not seated → out-of-roster-name (prior-game/template name)
 *   - "N号 Name"/"Player N Name" pair that contradicts the roster
 *                                → wrong-name-seat-pair
 *
 * plus a translation check: the translated text must reference exactly the
 * same seats (and introduce no new name entities) as its source.
 */

import type { Player } from '../types';
import { AI_NAMES } from '../constants';
import entities from './aiwolf-entities.json';

export type ViolationKind =
  | 'agent-ref'
  | 'aiwolf-name'
  | 'out-of-roster-seat'
  | 'out-of-roster-name'
  | 'wrong-name-seat-pair'
  | 'translation-referent-drift';

export interface NameViolation {
  kind: ViolationKind;
  /** The offending substring as matched. */
  match: string;
  /** Human-readable explanation with the expected roster fact when known. */
  detail: string;
}

// ─── entity patterns ─────────────────────────────────────────────────────────

export const AGENT_REF_RE = /Agent\s*\[\s*\d+\s*\]/g;

/** Latin names: case-sensitive, not embedded in a longer Latin word. */
const latinNamePatterns: ReadonlyArray<{ name: string; re: RegExp }> =
  entities.latinNames.map(name => ({
    name,
    re: new RegExp(`(?<![A-Za-z])${name}(?![a-z])`, 'g'),
  }));

/** Katakana names: not embedded in a longer katakana run. */
const katakanaNamePatterns: ReadonlyArray<{ name: string; re: RegExp }> =
  entities.katakanaNames.map(name => ({
    name,
    re: new RegExp(`(?<![ァ-ヶー])${name}(?![ァ-ヶー])`, 'g'),
  }));

export const KNOWN_AIWOLF_NAMES: ReadonlyArray<string> = [
  ...entities.latinNames,
  ...entities.katakanaNames,
];

// ─── seat-reference extraction ───────────────────────────────────────────────

/**
 * All seat numbers referenced by a text, via the three reference syntaxes the
 * codebase and corpus use: `N号`, `Player N` (case-insensitive), `Agent[N]`.
 */
export const extractSeatRefs = (text: string): number[] => {
  const refs: number[] = [];
  for (const m of text.matchAll(/(\d{1,2})\s*号/g)) refs.push(Number(m[1]));
  for (const m of text.matchAll(/player\s*(\d{1,2})/gi)) refs.push(Number(m[1]));
  for (const m of text.matchAll(/Agent\s*\[\s*(\d{1,2})\s*\]/g)) refs.push(Number(m[1]));
  return refs;
};

// ─── main detector ───────────────────────────────────────────────────────────

export const detectNameViolations = (text: string, roster: Player[]): NameViolation[] => {
  const violations: NameViolation[] = [];
  if (!text) return violations;

  const rosterIds = new Set(roster.map(p => p.id));
  const rosterNames = new Set(roster.map(p => p.name));

  // (c) raw AIWolf agent references
  for (const m of text.matchAll(AGENT_REF_RE)) {
    violations.push({
      kind: 'agent-ref',
      match: m[0],
      detail: `raw AIWolf entity "${m[0]}" — not a roster reference`,
    });
  }

  // (c) known AIWolf personal names (JA romanized + katakana + EN)
  for (const { name, re } of [...latinNamePatterns, ...katakanaNamePatterns]) {
    if (rosterNames.has(name)) continue; // would be a legitimate roster name
    for (const m of text.matchAll(re)) {
      violations.push({
        kind: 'aiwolf-name',
        match: m[0],
        detail: `AIWolf corpus personal name "${name}" — not on the current roster`,
      });
    }
  }

  // (a) every seat reference must be a current-roster seat
  for (const seat of extractSeatRefs(text)) {
    if (!rosterIds.has(seat)) {
      violations.push({
        kind: 'out-of-roster-seat',
        match: `${seat}`,
        detail: `seat ${seat} referenced but roster has seats ${[...rosterIds].join(',')}`,
      });
    }
  }

  // (a) product AI names that are NOT on this game's roster (prior-game or
  // template pollution — e.g. a 12p-only name inside a 9p game).
  for (const name of AI_NAMES) {
    if (rosterNames.has(name)) continue;
    const re = new RegExp(`(?<![A-Za-z])${name}(?![a-z])`, 'g');
    for (const m of text.matchAll(re)) {
      violations.push({
        kind: 'out-of-roster-name',
        match: m[0],
        detail: `product AI name "${name}" is not seated in this game`,
      });
    }
  }

  // (b) "N号 Name" / "Player N Name" pairs must match the roster mapping
  const pairRes = [
    /(\d{1,2})\s*号\s+([A-Z][A-Za-z]+)/g,
    /Player\s*(\d{1,2})\s+([A-Z][A-Za-z]+)/g,
  ];
  for (const re of pairRes) {
    for (const m of text.matchAll(re)) {
      const seat = Number(m[1]);
      const name = m[2];
      if (!rosterNames.has(name)) continue; // non-roster names handled above
      const player = roster.find(p => p.id === seat);
      if (!player || player.name !== name) {
        violations.push({
          kind: 'wrong-name-seat-pair',
          match: m[0],
          detail: `pair "${m[0]}" contradicts roster (${name} is seat ${
            roster.find(p => p.name === name)?.id ?? '?'
          })`,
        });
      }
    }
  }

  return violations;
};

// ─── translation referent check ──────────────────────────────────────────────

/**
 * (d) A display-layer translation must not change player referents: the
 * translated text must reference exactly the same seat set as the source and
 * must not introduce any name entity the source did not contain.
 */
export const detectTranslationReferentDrift = (
  original: string,
  translated: string,
  roster: Player[],
): NameViolation[] => {
  const violations: NameViolation[] = [];
  const srcSeats = new Set(extractSeatRefs(original));
  const dstSeats = new Set(extractSeatRefs(translated));

  for (const seat of dstSeats) {
    if (!srcSeats.has(seat)) {
      violations.push({
        kind: 'translation-referent-drift',
        match: `${seat}`,
        detail: `translation introduces seat ${seat} absent from the source`,
      });
    }
  }
  for (const seat of srcSeats) {
    if (!dstSeats.has(seat)) {
      violations.push({
        kind: 'translation-referent-drift',
        match: `${seat}`,
        detail: `translation drops seat ${seat} present in the source`,
      });
    }
  }

  // Name entities introduced by the translation (AIWolf names, off-roster
  // product names, agent refs) are also drift — reuse the main detector but
  // only count matches that the source did not already contain.
  for (const v of detectNameViolations(translated, roster)) {
    if (!original.includes(v.match)) {
      violations.push({
        kind: 'translation-referent-drift',
        match: v.match,
        detail: `translation introduces entity "${v.match}" (${v.kind}) absent from the source`,
      });
    }
  }
  return violations;
};
