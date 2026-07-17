import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateAIDialogue, generateWolfChat } from './aiOrchestrator';
import { resolveGameLanguage } from '../hooks/useGameState';
import { isCannedEnglishStub } from '../i18n';
import { getRoleCamp } from '../gameEngine';
import { GamePhase, Player, Role } from '../types';
import { pickSpeech, pickWolfNightSpeech } from '../services/speechLibrary';
import { generateSpeechWithLLM } from './geminiAdapter';

/**
 * Tests for lobby-language-authority: the game language captured at startGame
 * threads through all three day-speech layers and wolf night chat, so EN games
 * produce native English speeches while zh games stay byte-identical.
 * All LLM and speech-library calls are mocked — no network.
 */

vi.mock('./geminiAdapter', () => ({
  generateSpeechWithLLM: vi.fn(async () => null),
  generateActionWithLLM: vi.fn(async () => ({ targetId: null })),
}));

vi.mock('../services/speechLibrary', () => ({
  pickSpeech: vi.fn(async () => ''),
  pickWolfNightSpeech: vi.fn(async () => ''),
}));

const mockLLM = vi.mocked(generateSpeechWithLLM);
const mockPickSpeech = vi.mocked(pickSpeech);
const mockPickWolfNightSpeech = vi.mocked(pickWolfNightSpeech);

const mkPlayer = (id: number, role: Role, isHuman = false): Player => ({
  id, name: isHuman ? 'Guest' : `P${id}`, role, camp: getRoleCamp(role),
  isAlive: true, canVote: true, isRevealed: false,
  avatarUrl: '', aiPersonality: '', traits: [], aiModelLabel: '',
  isHuman, publicClaims: [], privateKnowledge: [], suspicionMap: {},
});

// 9-player standard board: 3 villagers, 3 wolves, seer, witch, hunter
const makeBoard = (): Player[] => [
  mkPlayer(1, Role.VILLAGER, true),
  mkPlayer(2, Role.WEREWOLF), mkPlayer(3, Role.WEREWOLF), mkPlayer(4, Role.WEREWOLF),
  mkPlayer(5, Role.SEER), mkPlayer(6, Role.WITCH), mkPlayer(7, Role.HUNTER),
  mkPlayer(8, Role.VILLAGER), mkPlayer(9, Role.VILLAGER),
];

const emptyNight = { wolfKillId: null, witchPoisonId: null, witchSaved: false };
const hasCJK = (text: string) => /[一-鿿㐀-䶿ぁ-ゟ゠-ヿ]/.test(text);

const dialogue = (
  speaker: Player,
  players: Player[],
  language?: 'zh' | 'en',
  seerInfo: { targetId: number; isGood: boolean } | null = null,
) =>
  generateAIDialogue(
    speaker, players, [], GamePhase.DAY_DISCUSSION, [], 1, seerInfo, [], emptyNight, language,
  );

beforeEach(() => {
  mockLLM.mockReset().mockResolvedValue(null);
  mockPickSpeech.mockReset().mockResolvedValue('');
  mockPickWolfNightSpeech.mockReset().mockResolvedValue('');
});

describe('resolveGameLanguage — capture at startGame', () => {
  it('defaults to zh when the lobby language is not provided', () => {
    expect(resolveGameLanguage()).toBe('zh');
    expect(resolveGameLanguage(undefined)).toBe('zh');
  });

  it('passes the lobby selection through unchanged', () => {
    expect(resolveGameLanguage('en')).toBe('en');
    expect(resolveGameLanguage('zh')).toBe('zh');
  });
});

describe('generateAIDialogue — LLM layer language threading', () => {
  it('EN mode prompts for a full English speech and accepts substantive English', async () => {
    const players = makeBoard();
    const en = 'I think Player 3 has been contradicting Player 5 all day, and the vote pattern from last round makes Player 3 the clearest wolf candidate for me right now.';
    mockLLM.mockResolvedValue({ zh: '怀疑3号。', en });

    const result = await dialogue(players[7], players, 'en');

    expect(result.en).toBe(en);
    const [systemPrompt, userPrompt] = mockLLM.mock.calls[0];
    expect(userPrompt).toContain('full daytime speech in ENGLISH');
    expect(systemPrompt).not.toContain('狼人杀高手');
  });

  it('EN mode rejects a short stub in en and falls to the next layer', async () => {
    const players = makeBoard();
    mockLLM.mockResolvedValue({ zh: '随便说说而已。', en: 'Frames Player 3.' });

    const result = await dialogue(players[7], players, 'en');

    expect(result.en).not.toBe('Frames Player 3.');
    expect(isCannedEnglishStub(result.en)).toBe(false);
    expect(hasCJK(result.en)).toBe(false);
  });

  it('zh default keeps today\'s Chinese prompt and isChinese acceptance', async () => {
    const players = makeBoard();
    const zh = '我站好人视角，三号的发言前后矛盾，今天建议大家重点盘三号的逻辑，票型也要跟上。';
    mockLLM.mockResolvedValue({ zh, en: 'short summary' });

    const result = await dialogue(players[7], players);

    expect(result.zh).toBe(zh);
    const [systemPrompt, userPrompt] = mockLLM.mock.calls[0];
    expect(systemPrompt).toContain('你是一名狼人杀高手');
    expect(userPrompt).toContain('请输出一段白天发言（80-180中文字符，必须提到具体玩家编号）');
  });
});

describe('generateAIDialogue — library layer', () => {
  it('EN mode asks the library for English and appends an English mention', async () => {
    const players = makeBoard();
    const libText = 'I want to hear more from the quiet seats before we vote anyone out today.';
    mockPickSpeech.mockResolvedValue(libText);

    const result = await dialogue(players[7], players, 'en');

    expect(mockPickSpeech).toHaveBeenCalledWith(Role.VILLAGER, [], 1, { language: 'en' });
    expect(result.en).toContain(libText);
    expect(result.en).toMatch(/\(watching Player \d+\)/);
    expect(hasCJK(result.en)).toBe(false);
    expect(isCannedEnglishStub(result.en)).toBe(false);
  });

  it('EN mode rejects a non-English library pick and uses the English fallback', async () => {
    const players = makeBoard();
    mockPickSpeech.mockResolvedValue('三号今天发言很奇怪，我怀疑他是狼人，建议大家重点盘他。');

    const result = await dialogue(players[7], players, 'en');

    expect(hasCJK(result.en)).toBe(false);
    expect(isCannedEnglishStub(result.en)).toBe(false);
    expect(result.en).toMatch(/Player \d+/);
  });

  it('zh default keeps the existing pick, mention, and canned en stub', async () => {
    const players = makeBoard();
    const libText = '我觉得今天信息还不够，大家先把发言听完再决定票型，不要乱推人。';
    mockPickSpeech.mockResolvedValue(libText);

    const result = await dialogue(players[7], players);

    expect(mockPickSpeech).toHaveBeenCalledWith(Role.VILLAGER, [], 1, { language: 'zh' });
    expect(result.zh).toContain(libText);
    expect(result.zh).toMatch(/（关注\d+号）/);
    expect(result.en).toBe('Speaks based on game situation.');
  });
});

describe('generateAIDialogue — hardcoded fallback layer (buildFallback)', () => {
  it('zh default returns canned en stubs with full Chinese speech (unchanged)', async () => {
    const players = makeBoard();

    const villager = await dialogue(players[7], players);
    expect(isCannedEnglishStub(villager.en)).toBe(true);
    expect(hasCJK(villager.zh)).toBe(true);

    const wolf = await dialogue(players[1], players);
    expect(wolf.en).toMatch(/^Frames Player (\d+|\?)\.$/);

    const seer = await dialogue(players[4], players, undefined, { targetId: 3, isGood: false });
    expect(seer.en).toBe('Seer reports: Player 3 is WOLF.');
    expect(seer.zh).toContain('我是预言家，昨晚验了3号');
  });

  it('EN mode returns real full-English lines, never the canned stubs', async () => {
    const players = makeBoard();

    const villager = await dialogue(players[7], players, 'en');
    expect(isCannedEnglishStub(villager.en)).toBe(false);
    expect(hasCJK(villager.en)).toBe(false);
    expect(villager.en).toMatch(/Player \d+/);
    expect(villager.en.split(/\s+/).length).toBeGreaterThanOrEqual(12);
    // zh original still carried as the translation source
    expect(hasCJK(villager.zh)).toBe(true);

    const wolf = await dialogue(players[1], players, 'en');
    expect(isCannedEnglishStub(wolf.en)).toBe(false);
    expect(hasCJK(wolf.en)).toBe(false);
    expect(wolf.en).toMatch(/Player \d+/);

    const seer = await dialogue(players[4], players, 'en', { targetId: 3, isGood: true });
    expect(isCannedEnglishStub(seer.en)).toBe(false);
    expect(seer.en).toContain('I am the seer');
    expect(seer.en).toContain('Player 3');
  });
});

describe('generateWolfChat — language threading', () => {
  it('EN mode uses an English prompt, EN library preference, and English fallback lines', async () => {
    const players = makeBoard();
    const wolves = players.filter(p => p.role === Role.WEREWOLF);

    const chat = await generateWolfChat(wolves, players, [], 1, [], 'en');

    const [systemPrompt] = mockLLM.mock.calls[0];
    expect(systemPrompt).toContain('Discuss strategy concisely in English');
    expect(mockPickWolfNightSpeech).toHaveBeenCalledWith('en');
    expect(chat).toHaveLength(3);
    for (const message of chat) {
      expect(hasCJK(message.message)).toBe(false);
      expect(message.message.length).toBeGreaterThan(0);
    }
    expect(chat[0].message).toMatch(/Player \d+/);
  });

  it('EN mode rejects a non-English library pick for night chat', async () => {
    const players = makeBoard();
    const wolves = players.filter(p => p.role === Role.WEREWOLF);
    mockPickWolfNightSpeech.mockResolvedValue('今晚刀五号，明天我悍跳预言家，你们倒钩。');

    const chat = await generateWolfChat(wolves, players, [], 1, [], 'en');

    for (const message of chat) {
      expect(hasCJK(message.message)).toBe(false);
    }
  });

  it('EN mode keeps an English library pick', async () => {
    const players = makeBoard();
    const wolves = players.filter(p => p.role === Role.WEREWOLF);
    const libText = 'Let us take the seer candidate tonight and have one of us fake-claim tomorrow.';
    mockPickWolfNightSpeech.mockResolvedValue(libText);

    const chat = await generateWolfChat(wolves, players, [], 1, [], 'en');

    for (const message of chat) {
      expect(message.message).toBe(libText);
    }
  });

  it('zh default keeps the existing Chinese prompt and hardcoded lines', async () => {
    const players = makeBoard();
    const wolves = players.filter(p => p.role === Role.WEREWOLF);

    const chat = await generateWolfChat(wolves, players, [], 1, []);

    const [systemPrompt] = mockLLM.mock.calls[0];
    expect(systemPrompt).toBe('你们是狼人夜间团队，用中文简洁商量策略。');
    expect(mockPickWolfNightSpeech).toHaveBeenCalledWith('zh');
    expect(chat[0].message).toBe('我建议刀1号。');
    expect(chat[1].message).toBe('明天需要一张牌悍跳预言家，我可以跳。');
    expect(chat[2].message).toBe('白天别冲，倒钩配合悍跳狼。');
  });
});
