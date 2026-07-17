import { describe, expect, it } from 'vitest';
import { Role } from '../types';
import {
  pickSpeechFromEntries,
  revealsHiddenRole,
  type SpeechEntry,
} from './speechLibrary';

const entry = (text: string, overrides: Partial<SpeechEntry> = {}): SpeechEntry => ({
  text,
  role: 'WEREWOLF',
  day: 1,
  tags: [],
  ...overrides,
});

// Selection is random — repeat picks to exercise the whole pool.
const pickMany = (
  entries: SpeechEntry[],
  role: Role,
  options?: Parameters<typeof pickSpeechFromEntries>[4],
): Set<string> => {
  const picked = new Set<string>();
  for (let i = 0; i < 200; i++) {
    picked.add(pickSpeechFromEntries(entries, role, [], 1, options));
  }
  return picked;
};

describe('revealsHiddenRole', () => {
  it('flags obvious wolf self-reveals for a werewolf speaker (JA/ZH/EN)', () => {
    const leaks = [
      '私は人狼だ、みんな騙されている。',
      '僕が人狼です。',
      '我是狼人，你们都猜错了。',
      '我就是狼，怎么样。',
      'I am a werewolf, deal with it.',
      "I'm the werewolf you are looking for.",
    ];
    for (const text of leaks) {
      expect(revealsHiddenRole(text, Role.WEREWOLF), text).toBe(true);
    }
  });

  it('flags possessed/狂人 self-reveals for a werewolf speaker', () => {
    const leaks = ['私は狂人です。', '我是狂人，帮狼说话。', 'I am the possessed.'];
    for (const text of leaks) {
      expect(revealsHiddenRole(text, Role.WEREWOLF), text).toBe(true);
    }
  });

  it('does not flag denials of being a wolf', () => {
    const denials = [
      '私は人狼ではない、信じてほしい。',
      '私は人狼じゃないよ。',
      '我不是狼人，请查我。',
      'I am not a werewolf, check me tonight.',
    ];
    for (const text of denials) {
      expect(revealsHiddenRole(text, Role.WEREWOLF), text).toBe(false);
    }
  });

  it('does not flag seer claims — CO is a legitimate strategy, even for a wolf', () => {
    const seerClaims = [
      '我是预言家，昨晚查了3号是金水。',
      '私は占い師です。3番は白でした。',
      'I am the seer and I checked player 3.',
    ];
    for (const text of seerClaims) {
      expect(revealsHiddenRole(text, Role.WEREWOLF), text).toBe(false);
      expect(revealsHiddenRole(text, Role.SEER), text).toBe(false);
    }
  });

  it('applies only to the speaker role — non-wolf speakers are not filtered', () => {
    expect(revealsHiddenRole('我是狼人', Role.VILLAGER)).toBe(false);
    expect(revealsHiddenRole('私は人狼だ', Role.SEER)).toBe(false);
  });
});

describe('pickSpeechFromEntries — leakage filter', () => {
  const leakText = '我是狼人，随便你们。';
  const safeTexts = ['三号发言有问题，重点查他。', '我建议今天票四号。', '二号的逻辑站不住脚。'];
  const pool = [entry(leakText), ...safeTexts.map(t => entry(t))];

  it('never picks a wolf self-reveal for a werewolf speaker in day picks', () => {
    const picked = pickMany(pool, Role.WEREWOLF);
    expect(picked.has(leakText)).toBe(false);
    expect(picked.size).toBeGreaterThan(0);
    for (const text of picked) expect(safeTexts).toContain(text);
  });

  it('keeps seer claims pickable for a werewolf speaker (fake-claim strategy)', () => {
    const seerClaim = '我是预言家，昨晚验了三号是查杀。';
    const claimPool = [entry(seerClaim), entry(seerClaim), entry(seerClaim)];
    const picked = pickMany(claimPool, Role.WEREWOLF);
    expect(picked.has(seerClaim)).toBe(true);
  });

  it('allows wolf self-reveals when the filter is off (wolf night chat scope)', () => {
    const nightPool = [entry(leakText)];
    const picked = pickMany(nightPool, Role.WEREWOLF, { filterSelfReveal: false });
    expect(picked.has(leakText)).toBe(true);
  });

  it('returns "" when every entry leaks (callers fall back on empty picks)', () => {
    const allLeaking = [entry('我是狼人。'), entry('I am a werewolf.')];
    expect(pickSpeechFromEntries(allLeaking, Role.WEREWOLF)).toBe('');
  });

  it('returns "" for an empty pool', () => {
    expect(pickSpeechFromEntries([], Role.WEREWOLF)).toBe('');
  });
});

describe('pickSpeechFromEntries — language preference', () => {
  const zhTexts = ['三号今天发言很奇怪，我怀疑他。', '我建议大家票四号出局。', '二号昨天的投票很可疑。'];
  const enTexts = [
    'Player three acted strangely today, I suspect them.',
    'I suggest we vote player four out.',
    'The vote from player two yesterday was suspicious.',
  ];
  const jaText = '3番の発言はおかしい、怪しいと思う。';
  const mixedPool = [...zhTexts, ...enTexts, jaText].map(t => entry(t, { role: 'VILLAGER' }));

  it('prefers Chinese entries by default', () => {
    const picked = pickMany(mixedPool, Role.VILLAGER);
    for (const text of picked) expect(zhTexts).toContain(text);
  });

  it('prefers English entries when language is "en"', () => {
    const picked = pickMany(mixedPool, Role.VILLAGER, { language: 'en' });
    for (const text of picked) expect(enTexts).toContain(text);
  });

  it('falls back to the mixed pool when fewer than 3 entries match the language', () => {
    const thinPool = [entry(zhTexts[0]), entry(jaText), entry(jaText + '本当に。')];
    const picked = pickMany(thinPool, Role.VILLAGER); // zh requested, only 1 zh entry
    expect(picked.has('')).toBe(false);
    for (const text of picked) {
      expect(thinPool.map(e => e.text)).toContain(text);
    }
    // Fallback means non-Chinese entries stay reachable.
    expect([...picked].some(t => t !== zhTexts[0])).toBe(true);
  });

  it('never returns "" just because no entry matches the language', () => {
    const noMatch = [entry(jaText), entry(jaText + 'ね。')];
    const picked = pickMany(noMatch, Role.VILLAGER, { language: 'en' });
    expect(picked.has('')).toBe(false);
  });

  it('combines EN preference with the self-reveal filter off (wolf night chat)', () => {
    // Mirrors pickWolfNightSpeech('en'): language 'en' + filterSelfReveal false.
    const enReveal = 'I am a werewolf, let us pick the kill together.';
    const pool = [entry(enReveal), ...enTexts.map(t => entry(t)), ...zhTexts.map(t => entry(t))];
    const picked = pickMany(pool, Role.WEREWOLF, { language: 'en', filterSelfReveal: false });
    for (const text of picked) expect([enReveal, ...enTexts]).toContain(text);
    expect(picked.has(enReveal)).toBe(true);
  });
});

describe('pickSpeechFromEntries — existing behavior retained', () => {
  it('still honors preferred tags within the filtered pool', () => {
    const tagged = entry('我是好人，票三号，理由如下。', { tags: ['voting'] });
    const untagged = ['一号发言太水了。', '二号的态度很奇怪。', '四号一直在带节奏。'].map(t =>
      entry(t),
    );
    const pool = [tagged, ...untagged];
    for (let i = 0; i < 50; i++) {
      expect(pickSpeechFromEntries(pool, Role.VILLAGER, ['voting'], 1)).toBe(tagged.text);
    }
  });

  it('filters by day proximity when enough entries match the round', () => {
    const nearDay = ['第一天先听发言。', '第一轮不要乱票。', '先看预言家有没有跳。', '今天信息还太少。', '先归票再说。'].map(
      t => entry(t, { day: 1 }),
    );
    const farDay = entry('决赛轮了，狼人就在我们中间。', { day: 5 });
    const picked = pickMany([...nearDay, farDay], Role.VILLAGER);
    expect(picked.has(farDay.text)).toBe(false);
  });
});
