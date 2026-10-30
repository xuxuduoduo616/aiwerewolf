import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateAIDialogue, generateWolfChat, setAIExpressionModel } from './aiOrchestrator';
import { AI_EXPRESSION_MODEL_IDS, DEFAULT_EXPRESSION_MODEL } from './modelCatalog';
import { makeAuditRoster } from '../diagnostics/fixtures';
import { GamePhase, Role } from '../types';
import { needsTranslation } from '../services/translationService';
import { pickTranslationSource } from '../i18n';

// Exercise the actual adapter and corpus, stubbing only the network boundary.
const english = 'I think Player 3 needs to explain that vote before we move on, because the village needs a consistent account of what happened yesterday.';
const nightEnglish = 'Let us target Player 5 tonight and keep our stories consistent tomorrow.';
const players = makeAuditRoster();
const wolves = players.filter(p => p.role === Role.WEREWOLF);
let fetchMock: ReturnType<typeof vi.fn>;
const respond = (payload: unknown) => fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: JSON.stringify(payload) }) });
const dialogue = (language?: 'en' | 'zh') => generateAIDialogue(
  players[7], players, [], GamePhase.DAY_DISCUSSION, [], 1, null, [], undefined, language,
);
const expectEnglish = (text: string) => {
  expect(text).toMatch(/[a-zA-Z]/);
  expect(text).not.toMatch(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u);
  expect(needsTranslation(text, 'en')).toBe(false);
};

beforeEach(() => {
  fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  setAIExpressionModel(DEFAULT_EXPRESSION_MODEL);
});
afterEach(() => { vi.unstubAllGlobals(); setAIExpressionModel(DEFAULT_EXPRESSION_MODEL); });

describe('English default across the real expression pipeline', () => {
  it.each(AI_EXPRESSION_MODEL_IDS)('accepts English-only speech from %s with one request', async model => {
    setAIExpressionModel(model);
    respond({ en: english });
    const result = await dialogue();
    expect(result).toEqual({ en: english, zh: '' });
    expectEnglish(pickTranslationSource({ message: result.en, translation: result.zh, isSystem: false }, 'en'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, request] = fetchMock.mock.calls[0];
    expect(endpoint).toBe('/.netlify/functions/provider-adapter');
    const body = JSON.parse(request.body);
    expect(body.model).toBe(model);
    expect(body.prompt).toContain('OUTPUT LANGUAGE: English only');
    expect(body.prompt).not.toMatch(/[\p{Script=Han}]/u);
    expect(body.prompt).not.toContain('Chinese summary');
  });

  it.each(AI_EXPRESSION_MODEL_IDS)('accepts the actual night messages schema from %s', async model => {
    setAIExpressionModel(model);
    respond({ messages: [{ speakerId: 2, message: nightEnglish, strategyTag: '刀口' }] });
    const result = await generateWolfChat(wolves, players, [], 1);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe(nightEnglish);
    expectEnglish(result[0].message);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(model);
  });

  it.each([
    '三号今天的表现很可疑，我建议大家先听完发言再投票。',
    `${english} 我觉得他是狼。`,
    '今日は三番が怪しいと思います。',
    `${english} ｱｲｳｴｵ`,
    `${english} 𠀀`,
  ])('rejects a non-English model response without a translation or repair request: %s', async bad => {
    respond({ en: bad, zh: bad });
    expectEnglish((await dialogue()).en);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    respond({ messages: [{ speakerId: 2, message: bad, strategyTag: '刀口' }] });
    const messages = await generateWolfChat(wolves, players, [], 1);
    expect(messages.length).toBeGreaterThan(0);
    messages.forEach(message => expectEnglish(message.message));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([null, { en: 123, zh: {} }, { messages: 'bad' }, { messages: [null, 5, { speakerId: 2, message: {} }] }])('falls back safely on malformed payload %j', async payload => {
    respond(payload);
    expectEnglish((await dialogue()).en);
    const messages = await generateWolfChat(wolves, players, [], 1);
    messages.forEach(message => expectEnglish(message.message));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps all role fallbacks and night chat English when the provider is offline', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    for (const player of players) {
      const result = await generateAIDialogue(player, players, [], GamePhase.DAY_DISCUSSION, [], 1, null);
      expectEnglish(result.en);
    }
    (await generateWolfChat(wolves, players, [], 1)).forEach(message => expectEnglish(message.message));
    expect(fetchMock).toHaveBeenCalledTimes(players.length + 1);
  });

  it('supports explicit Chinese without changing the default', async () => {
    const zh = '我建议今天先听三号解释投票原因，大家把发言听完再一起决定。';
    respond({ zh });
    expect((await dialogue('zh')).zh).toBe(zh);
    respond({ messages: [{ speakerId: 2, message: '今晚先刀五号，明天我们保持一致的说法。', strategyTag: '刀口' }] });
    expect((await generateWolfChat(wolves, players, [], 1, [], 'zh'))[0].message).toContain('今晚');
  });
});
