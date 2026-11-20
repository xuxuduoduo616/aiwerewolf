import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateAIDialogue, generateWolfChat, setAIExpressionModel } from './aiOrchestrator';
import { resolveSingleRoute } from './modelRouting';
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
    expect(body.model).toBe(resolveSingleRoute(model, 'normal'));
    expect(body.prompt).toContain('OUTPUT LANGUAGE: English only');
    expect(body.prompt).not.toMatch(/[\p{Script=Han}]/u);
    expect(body.prompt).not.toContain('Chinese summary');
  });

  it.each(AI_EXPRESSION_MODEL_IDS)('accepts the actual night messages schema from %s', async model => {
    setAIExpressionModel(model);
    respond({ messages: [{ speakerId: 2, message: nightEnglish, strategyTag: '刀口' }] });
    const result = await generateWolfChat(wolves, players, [], 1);
    expect(result).toHaveLength(wolves.length);
    expect(result[0].message).toBe(nightEnglish);
    expectEnglish(result[0].message);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(resolveSingleRoute(model, 'normal'));
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

// These tests exercise real orchestrator + browser adapter, mocking HTTP only.
describe('participating model requests and accepted provenance', () => {
  const routes = ['gemini-3.6-flash', 'deepseek-flash', 'deepseek-v4-pro'] as const;
  const routed = players.map((player, index) => ({ ...player, aiAssignedModel: routes[index % routes.length] }));
  const makeLifecycle = (sources: unknown[]) => ({
    runWhenActive: async <T,>(work: () => T | Promise<T>) => work(),
    deferCommit: (commit: () => void) => commit(),
    onSource: (source: unknown) => sources.push(source),
  });
  it.each(['easy', 'normal', 'hard'] as const)('calls each daytime seat route at %s and validates server provenance', async difficulty => {
    setAIExpressionModel('multi-ai-model', difficulty);
    fetchMock.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ text: JSON.stringify({ en: english }), model_used: body.model, fallback_used: false }) };
    });
    for (const route of routes) {
      const speaker = routed.find(player => player.aiAssignedModel === route && !player.isHuman)!;
      const sources: unknown[] = [];
      await generateAIDialogue(speaker, routed, [], GamePhase.DAY_DISCUSSION, [], 1, null, [], undefined, 'en', makeLifecycle(sources));
      expect(sources).toEqual([{ model: route, fallback: false }]);
    }
    expect(fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body))).toEqual(routes.map(model => expect.objectContaining({ model, difficulty })));
  });
  it('groups only identical night routes and never writes for a human or unrequested speaker', async () => {
    const pack = routed.filter(player => player.role === Role.WEREWOLF).map((player, index) => ({ ...player, aiAssignedModel: routes[index % routes.length], isHuman: false }));
    const roster = routed.map(player => pack.find(wolf => wolf.id === player.id) ?? player);
    fetchMock.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      const requested = /Requested AI speakers only: ([^\n]+)/.exec(body.prompt)![1];
      const ids = [...requested.matchAll(/Player (\d+)/g)].map(match => Number(match[1]));
      return { ok: true, json: async () => ({ model_used: body.model, fallback_used: false,
        text: JSON.stringify({ messages: [...ids.map(speakerId => ({ speakerId, message: nightEnglish, strategyTag: '刀口' })), { speakerId: 1, message: nightEnglish }] }) }) };
    });
    const result = await generateWolfChat(pack, roster, [], 1);
    expect(result.map(message => message.speakerId)).toEqual(pack.map(player => player.id));
    result.forEach(message => expect(message.dialogueSource).toEqual({ model: pack.find(player => player.id === message.speakerId)!.aiAssignedModel, fallback: false }));
    expect(fetchMock).toHaveBeenCalledTimes(new Set(pack.map(player => player.aiAssignedModel)).size);
    for (const [, options] of fetchMock.mock.calls) {
      const body = JSON.parse(options.body);
      const ids = [.../Requested AI speakers only: ([^\n]+)/.exec(body.prompt)![1].matchAll(/Player (\d+)/g)].map(match => Number(match[1]));
      expect(ids.every(id => pack.find(player => player.id === id)!.aiAssignedModel === body.model)).toBe(true);
    }
  });
  it('attributes accepted Gemini fallback, unknown metadata, and guard rejection separately', async () => {
    const speaker = { ...players[7], aiAssignedModel: 'gemini-3.6-flash' as const };
    for (const [metadata, text, expected] of [
      [{ model_used: 'gemini-2.5-flash', fallback_used: true }, english, { model: 'gemini-2.5-flash', fallback: true }],
      [{}, english, { model: 'unknown', fallback: false }],
      [{ model_used: 'gemini-3.6-flash', fallback_used: false }, '中文不应通过英文发言', { model: 'local', fallback: true }],
    ] as const) {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: JSON.stringify({ en: text }), ...metadata }) });
      const sources: unknown[] = [];
      await generateAIDialogue(speaker, routed, [], GamePhase.DAY_DISCUSSION, [], 1, null, [], undefined, 'en', makeLifecycle(sources));
      expect(sources).toEqual([expected]);
    }
  });
});

describe('mixed-route night cancellation', () => {
  it('does not start a second route or accept provenance after cancellation', async () => {
    const pack = players.filter(player => player.role === Role.WEREWOLF).map((player, index) => ({ ...player, isHuman: false, aiAssignedModel: index === 0 ? 'gemini-3.6-flash' as const : 'deepseek-v4-pro' as const }));
    const controller = new AbortController();
    let release!: (value: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const commit = vi.fn();
    const pending = generateWolfChat(pack, players, [], 1, [], 'en', {
      signal: controller.signal,
      runWhenActive: async <T,>(work: () => T | Promise<T>) => controller.signal.aborted ? undefined : work(),
      deferCommit: commit,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    release({ ok: true, json: async () => ({ text: JSON.stringify({ messages: [{ speakerId: pack[0].id, message: nightEnglish }] }), model_used: 'gemini-3.6-flash', fallback_used: false }) });
    expect(await pending).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('verified remote-only mixed dialogue', () => {
  const primary = 'gemini-3.6-flash';
  const alternate = 'deepseek-flash';
  const backup = 'gemini-2.5-flash';
  const speaker = { ...players[7], aiAssignedModel: primary } as const;
  const sources: unknown[] = [];
  const commit = vi.fn((publish: () => void) => publish());
  const life = (mixedModels: readonly (typeof primary | typeof alternate | typeof backup)[], signal?: AbortSignal) => ({
    mixedModels,
    signal,
    runWhenActive: async <T,>(work: () => T | Promise<T>) => work(),
    deferCommit: commit,
    onSource: (source: unknown) => sources.push(source),
  });
  const speak = (lifecycle: ReturnType<typeof life>) => generateAIDialogue(
    speaker, players, [], GamePhase.DAY_DISCUSSION, [], 1, null, [], undefined, 'en', lifecycle,
  );
  const response = (payload: unknown, model_used: unknown, fallback_used: unknown = false) =>
    ({ ok: true, json: async () => ({ text: JSON.stringify(payload), model_used, fallback_used }) });
  const bodies = () => fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body));

  beforeEach(() => {
    sources.length = 0;
    commit.mockClear();
    setAIExpressionModel('multi-ai-model', 'hard');
  });

  it.each([
    ['HTTP failure', { ok: false, status: 503 }],
    ['network failure', new Error('offline')],
    ['fake source', response({ en: english }, alternate)],
    ['local source', response({ en: english }, 'local-fallback', true)],
    ['unverified proxy backup', response({ en: english }, backup, true)],
    ['invalid content', response({ en: '中文不应通过英文发言' }, primary)],
  ])('uses a verified alternate after %s with the same speaker and difficulty', async (_label, failed) => {
    if (failed instanceof Error) fetchMock.mockRejectedValueOnce(failed);
    else fetchMock.mockResolvedValueOnce(failed);
    fetchMock.mockResolvedValueOnce(response({ en: english }, alternate));
    expect(await speak(life([primary, alternate]))).toEqual({ en: english, zh: '' });
    expect(bodies().map(body => body.model)).toEqual([primary, alternate]);
    expect(bodies()[0].prompt).toBe(bodies()[1].prompt);
    expect(bodies().every(body => body.difficulty === 'hard')).toBe(true);
    expect(sources).toEqual([{ model: alternate, fallback: true }]);
    expect(commit).toHaveBeenCalledOnce();
  });

  it('accepts a verified proxy backup exactly once and does not repeat it after rejection', async () => {
    fetchMock.mockResolvedValueOnce(response({ en: english }, backup, true));
    expect(await speak(life([primary, alternate, backup]))).toEqual({ en: english, zh: '' });
    expect(bodies().map(body => body.model)).toEqual([primary]);
    expect(sources).toEqual([{ model: backup, fallback: true }]);

    fetchMock.mockClear().mockResolvedValueOnce(response({ en: 'Invalid' }, backup, true))
      .mockResolvedValueOnce({ ok: false });
    expect(await speak(life([primary, alternate, backup]))).toBeNull();
    expect(bodies().map(body => body.model)).toEqual([primary, alternate]);
    expect(commit).toHaveBeenCalledOnce();
  });

  it('returns no speech or commit after exhausting a single route or an empty pool', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: '', model_used: 'local-fallback', fallback_used: true }) });
    expect(await speak(life([primary]))).toBeNull();
    expect(await speak(life([]))).toBeNull();
    expect(bodies().map(body => body.model)).toEqual([primary]);
    expect(commit).not.toHaveBeenCalled();
    expect(sources).toEqual([]);
  });

  it('interrupts a timed-out primary and leaves time for its alternate', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      }));
      fetchMock.mockResolvedValueOnce(response({ en: english }, alternate));
      const result = speak(life([primary, alternate]));
      await vi.advanceTimersByTimeAsync(0);
      expect(bodies().map(body => body.model)).toEqual([primary]);
      await vi.advanceTimersByTimeAsync(12_000);
      expect(await result).toEqual({ en: english, zh: '' });
      expect(bodies().map(body => body.model)).toEqual([primary, alternate]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels an in-flight candidate without a retry or stale commit', async () => {
    const controller = new AbortController();
    let reject!: (reason: unknown) => void;
    let start!: () => void;
    const started = new Promise<void>(resolve => { start = resolve; });
    fetchMock.mockImplementationOnce(() => new Promise((_resolve, fail) => {
      reject = fail;
      start();
    }));
    const result = speak(life([primary, alternate], controller.signal));
    await started;
    controller.abort();
    reject(controller.signal.reason);
    expect(await result).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
  });

  it('retries only missing or rejected night speakers and preserves original order and provenance', async () => {
    const pack = wolves.map((wolf): typeof wolf => ({ ...wolf, aiAssignedModel: primary }));
    const [first, second, third] = pack.map(wolf => wolf.id);
    const line = (speakerId: number, message = nightEnglish) => ({ speakerId, message, strategyTag: '刀口' });
    fetchMock.mockResolvedValueOnce(response({ messages: [
      line(first), line(second), line(second), line(1),
    ] }, primary));
    fetchMock.mockResolvedValueOnce(response({ messages: [
      line(third, '中文不应通过英文发言'), line(second), line(first), line(1),
    ] }, alternate));
    const result = await generateWolfChat(pack, players, [], 1, [], 'en', life([primary, alternate]));
    expect(bodies().map(body => body.model)).toEqual([primary, alternate]);
    expect(bodies()[0].prompt).toContain(`Requested AI speakers only: Player ${first}, Player ${second}, Player ${third}\n`);
    expect(bodies()[1].prompt).toContain(`Requested AI speakers only: Player ${second}, Player ${third}\n`);
    expect(result.map(message => [message.speakerId, message.dialogueSource])).toEqual([
      [first, { model: primary, fallback: false }],
      [second, { model: alternate, fallback: true }],
    ]);
  });
});
