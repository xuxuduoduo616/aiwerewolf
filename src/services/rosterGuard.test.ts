/**
 * rosterGuard tests (card: ai-speech-roster-name-fix).
 *
 * Covers fix invariants:
 *   1  internal identity is the stable playerId — a contradicting "seat名"
 *      pair repairs to the structural seat reference, never to a guessed name;
 *   6  detected-bad text never passes: repair is verified by the detector,
 *      nameless fallback lines are roster-safe by construction;
 *   4  translation referent protection helper;
 *   8  diagnostic metadata is dev-console-only, never player-visible.
 */

import { describe, expect, it, vi } from 'vitest';
import { Role, type Player } from '../types';
import { AI_NAMES } from '../constants';
import { getRoleCamp } from '../gameEngine';
import { detectNameViolations, extractSeatRefs } from '../diagnostics/nameDetector';
import {
  emitSpeechDiagnostic,
  guardSpeechText,
  namelessFallbackLine,
  sanitizeForeignEntities,
  speechDiagnosticsEnabled,
  translationViolatesReferents,
} from './rosterGuard';

// 9p roster seated with the first nine product AI names (Luna … Jasper);
// Nova / Orion / Freya stay off-roster.
const ROLES: Role[] = [
  Role.VILLAGER, Role.WEREWOLF, Role.WEREWOLF, Role.WEREWOLF,
  Role.SEER, Role.WITCH, Role.HUNTER, Role.VILLAGER, Role.VILLAGER,
];
const makeRoster = (): Player[] =>
  ROLES.map((role, index) => ({
    id: index + 1, name: AI_NAMES[index], role, camp: getRoleCamp(role),
    isAlive: true, canVote: true, isRevealed: false, avatarUrl: '',
    aiPersonality: '', traits: [], aiModelLabel: '', isHuman: false,
    publicClaims: [], privateKnowledge: [], suspicionMap: {},
  }));

const roster = makeRoster();

describe('guardSpeechText — clean text passes through', () => {
  it('keeps roster-valid seat and name references untouched', () => {
    for (const text of [
      '我怀疑3号，今天先投他。',
      'I think Player 3 has been lying since Player 5 spoke.',
      `3号 ${roster[2].name}是金水，别动他。`, // correct seat-name pair
      `${roster[0].name}的发言我认可。`,
    ]) {
      const result = guardSpeechText(text, roster, 'zh');
      expect(result.ok, text).toBe(true);
      expect(result.repaired, text).toBe(false);
      expect(result.text, text).toBe(text);
    }
  });
});

describe('guardSpeechText — structural repair (invariant 6)', () => {
  it('repairs Agent refs and AIWolf names to seat-neutral placeholders', () => {
    const result = guardSpeechText('我觉得Agent[05]和サクラ都很可疑。', roster, 'zh');
    expect(result.ok).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.text).not.toContain('Agent');
    expect(result.text).not.toContain('サクラ');
    expect(result.text).toContain('那位玩家');
    expect(detectNameViolations(result.text, roster)).toHaveLength(0);
  });

  it('absorbs Japanese honorifics when repairing katakana names', () => {
    const result = guardSpeechText('サクラさんはどう思う？', roster, 'zh');
    expect(result.ok).toBe(true);
    expect(result.text).toBe('那位玩家はどう思う？');
  });

  it('repairs out-of-roster seat references without guessing a seat', () => {
    const zh = guardSpeechText('10号昨天的票型有问题。', roster, 'zh');
    expect(zh.ok).toBe(true);
    expect(zh.text).not.toContain('10号');
    expect(extractSeatRefs(zh.text)).toHaveLength(0);

    const en = guardSpeechText('Player 12 voted strangely yesterday.', roster, 'en');
    expect(en.ok).toBe(true);
    expect(en.text).toBe('that player voted strangely yesterday.');
  });

  it('repairs off-roster product AI names', () => {
    const result = guardSpeechText('Freya太安静了，重点看她。', roster, 'zh');
    expect(result.ok).toBe(true);
    expect(result.text).not.toContain('Freya');
    expect(detectNameViolations(result.text, roster)).toHaveLength(0);
  });

  it('keeps distinct placeholders for the first two distinct entities', () => {
    // Placeholders are assigned in replacement-pass order (Agent refs first),
    // deterministically; the two distinct entities must stay distinguishable.
    const result = guardSpeechText('サクラ和Agent[02]的发言都指向5号。', roster, 'zh');
    expect(result.ok).toBe(true);
    expect(result.text).toBe('另一位玩家和那位玩家的发言都指向5号。');
    expect(result.text).toContain('那位玩家');
    expect(result.text).toContain('另一位玩家');
  });
});

describe('guardSpeechText — invariant 1: playerId is authoritative', () => {
  it('resolves a roster-contradicting seat-name pair to the structural seat reference', () => {
    // roster[0] (Luna) sits on seat 1, so "3号 Luna" contradicts the roster.
    const result = guardSpeechText(`3号 ${roster[0].name}不可信。`, roster, 'zh');
    expect(result.ok).toBe(true);
    expect(result.text).toBe('3号不可信。');
    expect(result.text).not.toContain(roster[0].name);
  });

  it('never maps a foreign name onto a roster playerId', () => {
    const original = '今晚刀サクラ，明天悍跳。';
    const result = guardSpeechText(original, roster, 'zh');
    expect(result.ok).toBe(true);
    // Repair introduces no seat reference that the original did not contain.
    expect(extractSeatRefs(result.text)).toEqual(extractSeatRefs(original));
    for (const player of roster) {
      expect(result.text).not.toContain(player.name);
    }
  });
});

describe('namelessFallbackLine — roster-safe by construction', () => {
  it('contains no player reference for any roster, including an empty one', () => {
    for (const language of ['zh', 'en'] as const) {
      const line = namelessFallbackLine(language);
      expect(line.length).toBeGreaterThan(20);
      expect(detectNameViolations(line, roster)).toHaveLength(0);
      expect(detectNameViolations(line, [])).toHaveLength(0);
      expect(extractSeatRefs(line)).toHaveLength(0);
    }
  });
});

describe('sanitizeForeignEntities — prompt hygiene (H2)', () => {
  it('scrubs Agent refs and AIWolf names from historical log lines', () => {
    const line = '僕はAgent[04]、ハルの質問に答えるなら、まだCOしない。サクラさんはどう思う？';
    const sanitized = sanitizeForeignEntities(line, 'zh');
    expect(sanitized).not.toContain('Agent[04]');
    expect(sanitized).not.toContain('サクラ');
    expect(sanitized).not.toContain('ハル');
    expect(sanitized).toContain('某玩家');
  });

  it('preserves legitimate seat references', () => {
    expect(sanitizeForeignEntities('3号说サクラ很可疑。', 'zh')).toBe('3号说某玩家很可疑。');
  });
});

describe('translationViolatesReferents — H5 (invariant 4)', () => {
  it('accepts a translation that preserves the seat references', () => {
    expect(translationViolatesReferents('我怀疑3号。', 'I suspect Player 3.')).toBe(false);
  });

  it('rejects a translation that introduces a new seat', () => {
    expect(translationViolatesReferents('我怀疑3号。', 'I suspect Player 5.')).toBe(true);
  });

  it('rejects a translation that introduces a foreign name or Agent ref', () => {
    expect(translationViolatesReferents('我怀疑3号。', 'I suspect Player 3 — Sakura agrees.')).toBe(true);
    expect(translationViolatesReferents('我怀疑3号。', 'Agent[03] is suspicious.')).toBe(true);
  });

  it('tolerates a summarizing translation that drops referents (fail-safe: cannot point at a wrong player)', () => {
    expect(translationViolatesReferents('そうだね、3号が怪しいと思う。', '翻译结果')).toBe(false);
  });
});

describe('speech diagnostics — dev-console-only (invariant 8)', () => {
  it('is disabled outside vite dev (tests and production builds)', () => {
    expect(speechDiagnosticsEnabled()).toBe(false);
  });

  it('emits nothing player-visible when disabled', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    emitSpeechDiagnostic({ context: 'day-speech', source: 'library', speakerId: 1 });
    expect(debug).not.toHaveBeenCalled();
    debug.mockRestore();
  });
});
