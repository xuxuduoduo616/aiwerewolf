import { describe, expect, it } from 'vitest';
import { getRoleCamp } from '../gameEngine';
import { Role, type Player } from '../types';
import { parseSpeechEvidence } from './speechEvidenceParser';

const mkPlayer = (id: number, role: Role, isHuman = false): Player => ({
  id,
  name: isHuman ? 'Human' : `P${id}`,
  role,
  camp: getRoleCamp(role),
  isAlive: true,
  canVote: true,
  isRevealed: false,
  avatarUrl: '',
  aiPersonality: '',
  traits: [],
  aiModelLabel: '',
  isHuman,
  publicClaims: [],
  privateKnowledge: [],
  suspicionMap: {},
});

const make9Board = (): Player[] => [
  mkPlayer(1, Role.VILLAGER, true),
  mkPlayer(2, Role.WEREWOLF),
  mkPlayer(3, Role.SEER),
  mkPlayer(4, Role.WITCH),
  mkPlayer(5, Role.VILLAGER),
  mkPlayer(6, Role.HUNTER),
  mkPlayer(7, Role.WEREWOLF),
  mkPlayer(8, Role.VILLAGER),
  mkPlayer(9, Role.WEREWOLF),
];

describe('speechEvidenceParser — multi-target clause separation', () => {
  it('separates Chinese multi-target defense and accusation: 「我信 3 号，7 号才是狼」', () => {
    const players = make9Board();
    const res = parseSpeechEvidence('我信 3 号，7 号才是狼', 1, players, { round: 1 });

    expect(res.claims).toHaveLength(2);
    const c3 = res.claims.find(c => c.targetId === 3);
    const c7 = res.claims.find(c => c.targetId === 7);
    expect(c3?.polarity).toBe('defend');
    expect(c3?.confidence).toBeGreaterThan(0.5);
    expect(c7?.polarity).toBe('accuse');
    expect(c7?.confidence).toBeGreaterThan(0.7);
  });

  it('separates English multi-target defense and accusation: "I trust Player 3, Player 7 is the wolf"', () => {
    const players = make9Board();
    const res = parseSpeechEvidence('I trust Player 3, Player 7 is the wolf', 1, players, { round: 1 });

    expect(res.claims).toHaveLength(2);
    const c3 = res.claims.find(c => c.targetId === 3);
    const c7 = res.claims.find(c => c.targetId === 7);
    expect(c3?.polarity).toBe('defend');
    expect(c7?.polarity).toBe('accuse');
  });

  it('handles contrastive conjunctions and Seat/#N references across both languages', () => {
    const players = make9Board();
    const en = parseSpeechEvidence('I trust Seat 3 but #7 is suspicious', 1, players);
    expect(en.claims.find(c => c.targetId === 3)?.polarity).toBe('defend');
    expect(en.claims.find(c => c.targetId === 7)?.polarity).toBe('accuse');

    const zh = parseSpeechEvidence('我信3号不信7号', 1, players);
    expect(zh.claims.find(c => c.targetId === 3)?.polarity).toBe('defend');
    expect(zh.claims.find(c => c.targetId === 7)?.polarity).toBe('accuse');
  });
});

describe('speechEvidenceParser — negation handling', () => {
  it('turns negated accusations into weak defense (zh + en)', () => {
    const players = make9Board();
    const cases = [
      '3号不是狼',
      '我觉得3号不像狼',
      '大家今天千万别投3号',
      'Player 3 is not a wolf',
      "Player 3 isn't suspicious",
      "Don't vote Player 3 today",
    ];

    for (const speech of cases) {
      const res = parseSpeechEvidence(speech, 1, players);
      expect(res.claims, `failed on: ${speech}`).toHaveLength(1);
      expect(res.claims[0].targetId).toBe(3);
      expect(res.claims[0].polarity).toBe('defend');
      expect(res.claims[0].confidence).toBeCloseTo(0.55, 5);
    }
  });

  it('turns negated defense into weak accusation (zh + en)', () => {
    const players = make9Board();
    const cases = [
      '我不信3号',
      '3号不是好人',
      '3号不是金水',
      'I do not trust Player 3',
      "I don't trust Player 3",
      'Player 3 is not good',
      'Player 3 is not a villager',
    ];

    for (const speech of cases) {
      const res = parseSpeechEvidence(speech, 1, players);
      expect(res.claims, `failed on: ${speech}`).toHaveLength(1);
      expect(res.claims[0].targetId).toBe(3);
      expect(res.claims[0].polarity).toBe('accuse');
      expect(res.claims[0].confidence).toBeCloseTo(0.65, 5);
    }
  });
});

describe('speechEvidenceParser — quotation, attribution, and hypothetical suppression', () => {
  it('suppresses pure hypothetical and attributed accusations', () => {
    const players = make9Board();
    const suppressedCases = [
      '如果3号是狼',
      '如果3号是狼，我就投他',
      '假设3号是好人',
      '假如3号是狼人，那5号可能是真预言家',
      '5号说3号是狼',
      '刚才有人说3号是狼',
      'If Player 3 is a wolf, then we should exile them',
      'Suppose Player 3 is good',
      'Player 5 said Player 3 is a wolf',
      'Someone claimed Player 3 is lying',
    ];

    for (const speech of suppressedCases) {
      const res = parseSpeechEvidence(speech, 1, players);
      expect(res.claims, `expected no active claims for: ${speech}`).toEqual([]);
      expect(res.suppressedClauses.length).toBeGreaterThan(0);
    }
  });

  it('keeps the active rebuttal clause in compound quoted sentences', () => {
    const players = make9Board();
    const res = parseSpeechEvidence('刚才有人说2号是狼，但我觉得2号不是狼', 1, players);

    expect(res.suppressedClauses).toHaveLength(1);
    expect(res.claims).toHaveLength(1);
    expect(res.claims[0]).toMatchObject({
      targetId: 2,
      polarity: 'defend',
      confidence: 0.55,
    });

    // Also resolve pronoun rebuttal after attribution
    const pronounRes = parseSpeechEvidence('刚才有人说2号是狼，但我觉得他不是狼', 1, players);
    expect(pronounRes.claims).toHaveLength(1);
    expect(pronounRes.claims[0]).toMatchObject({
      targetId: 2,
      polarity: 'defend',
      confidence: 0.55,
    });
  });
});

describe('speechEvidenceParser — ambiguity, substring traps, and slang', () => {
  it('avoids substring traps: 信息, 假设, villager', () => {
    const players = make9Board();

    // "信息" must NOT trigger "信" defense
    expect(parseSpeechEvidence('3号给的信息不多', 1, players).claims).toEqual([]);
    // "假设" must NOT trigger "假" accusation
    expect(parseSpeechEvidence('假设3号是好人', 1, players).claims).toEqual([]);
    // "I am a villager, Player 3 was quiet" must NOT trigger defense on Player 3
    const villagerTrap = parseSpeechEvidence('I am a villager, Player 3 was quiet', 1, players);
    expect(villagerTrap.claims).toEqual([]);
    expect(villagerTrap.roleClaims.some(rc => rc.claimedRole === Role.VILLAGER)).toBe(true);
    // Neutral procedural vote mention must NOT falsely accuse
    expect(parseSpeechEvidence('I want to hear from Player 3 before voting.', 1, players).claims).toEqual([]);
  });

  it('recognizes core Werewolf slang and English keywords: 查杀, 金水, 银水, suspicious, voting', () => {
    const players = make9Board();

    expect(parseSpeechEvidence('3号是查杀', 1, players).claims[0]).toMatchObject({
      targetId: 3,
      polarity: 'check-wolf',
    });
    expect(parseSpeechEvidence('3号是金水', 1, players).claims[0]).toMatchObject({
      targetId: 3,
      polarity: 'check-good',
    });
    expect(parseSpeechEvidence('3号是银水', 1, players).claims[0]).toMatchObject({
      targetId: 3,
      polarity: 'defend',
      tag: 'silver-water',
    });
    expect(parseSpeechEvidence('Player 3 is suspicious', 1, players).claims[0]).toMatchObject({
      targetId: 3,
      polarity: 'accuse',
    });
    expect(parseSpeechEvidence('I am voting Player 3', 1, players).claims[0]).toMatchObject({
      targetId: 3,
      polarity: 'accuse',
    });
  });

  it('extracts public role claims and Seer check results in both languages', () => {
    const players = make9Board();

    const zhSeer = parseSpeechEvidence('我是预言家，昨晚验了2号，是查杀。', 3, players, { round: 1 });
    expect(zhSeer.roleClaims).toHaveLength(1);
    expect(zhSeer.roleClaims[0].claimedRole).toBe(Role.SEER);
    expect(zhSeer.claims).toHaveLength(1);
    expect(zhSeer.claims[0]).toMatchObject({
      speakerId: 3,
      targetId: 2,
      polarity: 'check-wolf',
    });

    const enSeer = parseSpeechEvidence(
      'I am the seer. Last night I checked Player 5 and the result is good — a confirmed villager-side player.',
      3,
      players,
      { round: 1 },
    );
    expect(enSeer.roleClaims.some(rc => rc.claimedRole === Role.SEER)).toBe(true);
    expect(enSeer.claims).toHaveLength(1);
    expect(enSeer.claims[0]).toMatchObject({
      speakerId: 3,
      targetId: 5,
      polarity: 'check-good',
    });
  });
});

describe('speechEvidenceParser — self-mention exclusion, invalid seats, and deduplication', () => {
  it('excludes self-mentions and unknown seat IDs', () => {
    const players = make9Board();
    const res = parseSpeechEvidence('1号是好人，99号是狼，我相信Player 1', 1, players);
    expect(res.claims).toEqual([]);
  });

  it('deduplicates repeated mentions of the same target within one speech', () => {
    const players = make9Board();
    const res = parseSpeechEvidence(
      'Player 3 is a wolf. Everyone should vote Player 3 today. Player 3 is definitely lying!',
      1,
      players,
    );
    expect(res.claims).toHaveLength(1);
    expect(res.claims[0]).toMatchObject({ targetId: 3, polarity: 'accuse' });

    // Seer check-wolf + accuse on same target collapses to the stronger check-wolf claim
    const seerRes = parseSpeechEvidence('我是预言家，昨晚验了2号是查杀，今天全票投2号。', 3, players);
    expect(seerRes.claims).toHaveLength(1);
    expect(seerRes.claims[0]).toMatchObject({ targetId: 2, polarity: 'check-wolf' });
  });
});
