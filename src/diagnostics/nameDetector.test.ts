import { describe, expect, it } from 'vitest';
import { makeAuditRoster } from './fixtures';
import {
  detectNameViolations,
  detectTranslationReferentDrift,
  extractSeatRefs,
  KNOWN_AIWOLF_NAMES,
} from './nameDetector';

// Ungated unit tests for the detector itself (always run — they must pass so
// the env-gated audit's failures are trustworthy detector output, not bugs).

const roster = makeAuditRoster(); // 9 seats: Luna..Jasper, ids 1..9

describe('nameDetector — AIWolf entities', () => {
  it('flags raw Agent[XX] references', () => {
    const v = detectNameViolations('僕はAgent[04]、よろしく。', roster);
    expect(v.some(x => x.kind === 'agent-ref' && x.match === 'Agent[04]')).toBe(true);
  });

  it('flags Latin AIWolf personal names with word boundaries', () => {
    expect(detectNameViolations('@Asuka state your vote now.', roster)
      .some(x => x.kind === 'aiwolf-name' && x.match === 'Asuka')).toBe(true);
    // Not embedded matches: "Ring" is not "Rin", "Karina" is not "Rina".
    expect(detectNameViolations('The Ring and Karina story.', roster)).toEqual([]);
  });

  it('flags katakana AIWolf names but not longer katakana runs', () => {
    expect(detectNameViolations('サクラさんは怪しい。', roster)
      .some(x => x.kind === 'aiwolf-name' && x.match === 'サクラ')).toBe(true);
    // タク must not match inside タクシー (bounded by katakana).
    expect(detectNameViolations('タクシーで行く。', roster)
      .filter(x => x.match === 'タク')).toEqual([]);
  });

  it('has a non-trivial known-name list', () => {
    expect(KNOWN_AIWOLF_NAMES.length).toBeGreaterThanOrEqual(40);
  });
});

describe('nameDetector — seat references', () => {
  it('extracts seats from N号 / Player N / Agent[N] syntaxes', () => {
    expect(extractSeatRefs('3号和Player 5，还有Agent[07]。')).toEqual([3, 5, 7]);
  });

  it('accepts in-roster seats and flags out-of-roster seats', () => {
    expect(detectNameViolations('我怀疑3号，今天投9号。', roster)).toEqual([]);
    const v = detectNameViolations('10号很可疑，投10号。', roster);
    expect(v.filter(x => x.kind === 'out-of-roster-seat')).toHaveLength(2);
  });

  it('accepts current-roster names and flags unseated product AI names', () => {
    // Luna (seat 1) is on the 9p roster; Freya (index 11) is not seated.
    expect(detectNameViolations('I trust Luna today.', roster)).toEqual([]);
    expect(detectNameViolations('Freya was lying yesterday.', roster)
      .some(x => x.kind === 'out-of-roster-name' && x.match === 'Freya')).toBe(true);
  });

  it('flags a name↔seat pair contradicting the roster', () => {
    // Seat 2 is Marcus, not Luna.
    expect(detectNameViolations('2号 Luna 的发言有问题。', roster)
      .some(x => x.kind === 'wrong-name-seat-pair')).toBe(true);
    expect(detectNameViolations('Player 1 Luna made a fair point.', roster)).toEqual([]);
  });
});

describe('nameDetector — translation referent drift', () => {
  it('accepts a faithful translation (号 ↔ Player N)', () => {
    expect(detectTranslationReferentDrift('我怀疑3号。', 'I suspect Player 3.', roster)).toEqual([]);
  });

  it('flags introduced, dropped, and injected referents', () => {
    const v = detectTranslationReferentDrift(
      '我怀疑3号。',
      'I suspect Player 5 — Sakura keeps lying.',
      roster,
    );
    const details = v.map(x => x.detail).join('\n');
    expect(details).toContain('introduces seat 5');
    expect(details).toContain('drops seat 3');
    expect(details).toContain('"Sakura"');
  });
});
