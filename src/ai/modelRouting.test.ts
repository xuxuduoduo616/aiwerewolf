import { describe, expect, it } from 'vitest';
import { createSeatRoutes, getMixedRouteCandidates, getVerifiedMixedRoutes, getPlayerModelBadge, validateDialogueSource, UNAVAILABLE_DIALOGUE_SOURCE } from './modelRouting';
import { getAvailableExpressionModels, MIXED_POOL_MODEL_IDS } from './modelCatalog';
const available = getAvailableExpressionModels({ default_model: 'gemini-3.6-flash', models: MIXED_POOL_MODEL_IDS.map(id => ({ id, label: id })) });

describe('stable per-seat routing', () => {
  it.each([8, 11])('covers all participating models for %s AI seats independently of difficulty', count => {
    expect(MIXED_POOL_MODEL_IDS).toEqual([
      'gemini-3.6-flash', 'deepseek-flash', 'deepseek-v4-pro',
      'doubao-seed-1.6-flash', 'doubao-seed-character', 'doubao-seed-2.1-lite',
    ]);
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const routes = createSeatRoutes(count, 'multi-ai-model', difficulty, available);
      expect(new Set(routes)).toEqual(new Set(MIXED_POOL_MODEL_IDS));
      expect(routes).toEqual(Array.from({ length: count }, (_, i) => MIXED_POOL_MODEL_IDS[i % MIXED_POOL_MODEL_IDS.length]));
    }
  });
  it('copies the verified pool and uses only its available subset', () => {
    const subset = available.map(model => ({ ...model, available: model.id === 'deepseek-v4-pro' }));
    const routes = createSeatRoutes(8, 'multi-ai-model', 'easy', subset);
    subset.forEach(model => { model.available = false; });
    expect(routes).toEqual(Array(8).fill('deepseek-v4-pro'));
    expect(createSeatRoutes(8, 'multi-ai-model', 'hard', subset)).toEqual(Array(8).fill(undefined));
  });
  it('cycles through only the available routes when Ark discovery is partial', () => {
    const verified = MIXED_POOL_MODEL_IDS.filter(id => id !== 'doubao-seed-2.1-lite');
    const subset = getAvailableExpressionModels({
      default_model: 'gemini-3.6-flash',
      models: MIXED_POOL_MODEL_IDS.map(id => ({ id, label: id })),
      verified_models: verified,
    });
    expect(createSeatRoutes(8, 'multi-ai-model', 'normal', subset)).toEqual([
      ...verified, ...verified.slice(0, 3),
    ]);
  });
  it('uses a verified backup as an alternative, or as the only seat model if it is the sole route', () => {
    const backup = { id: 'gemini-2.5-flash', label: 'Gemini backup', description: '', available: true } as const;
    const verified = getVerifiedMixedRoutes([...available, backup]);
    expect(getMixedRouteCandidates('deepseek-flash', verified)).toEqual([
      'deepseek-flash', 'gemini-3.6-flash', 'deepseek-v4-pro', 'doubao-seed-1.6-flash', 'doubao-seed-character', 'doubao-seed-2.1-lite', 'gemini-2.5-flash',
    ]);
    expect(createSeatRoutes(2, 'multi-ai-model', 'normal', [...available, backup])).toEqual(MIXED_POOL_MODEL_IDS.slice(0, 2));
    expect(createSeatRoutes(2, 'multi-ai-model', 'normal', [backup])).toEqual([backup.id, backup.id]);
    expect(getPlayerModelBadge({ aiDialogueSource: UNAVAILABLE_DIALOGUE_SOURCE })).toBe('Dialogue unavailable');
  });
  it.each(['easy', 'normal', 'hard'] as const)('preserves each explicit route at %s', difficulty => {
    for (const route of MIXED_POOL_MODEL_IDS) expect(createSeatRoutes(11, route, difficulty, available)).toEqual(Array(11).fill(route));
    expect(createSeatRoutes(8, 'deepseek-auto', difficulty)).toEqual(Array(8).fill(difficulty === 'hard' ? 'deepseek-v4-pro' : 'deepseek-flash'));
  });
});
describe('truthful source validation and badges', () => {
  it('validates direct and documented fallback only', () => {
    expect(validateDialogueSource('deepseek-flash', 'deepseek-flash', false)).toEqual({ model: 'deepseek-flash', fallback: false });
    expect(validateDialogueSource('gemini-3.6-flash', 'gemini-2.5-flash', true)).toEqual({ model: 'gemini-2.5-flash', fallback: true });
    expect(validateDialogueSource('deepseek-v4-pro', 'local-fallback', true)).toEqual({ model: 'local', fallback: true });
    for (const [used, flag] of [[undefined, false], ['GPT-4o', false], ['deepseek-v4-pro', false], ['deepseek-flash', undefined], ['gemini-2.5-flash', true]]) {
      expect(validateDialogueSource('deepseek-flash', used, flag).model).toBe('unknown');
    }
  });
  it.each([
    ['doubao-seed-1.6-flash', 'Doubao Seed 1.6 Flash'],
    ['doubao-seed-character', 'Doubao Seed Character'],
    ['doubao-seed-2.1-lite', 'Doubao Seed 2.1 Lite'],
  ] as const)('reports the accepted source for %s', (id, label) => {
    const source = validateDialogueSource(id, id, false);
    expect(source).toEqual({ model: id, fallback: false });
    expect(getPlayerModelBadge({ aiAssignedModel: id, aiDialogueSource: source })).toBe(label);
    expect(getPlayerModelBadge({ aiAssignedModel: id, aiDialogueSource: { model: 'local', fallback: true } })).toBe('Local dialogue');
  });
  it('does not promote a legacy random style to a model badge', () => {
    expect(getPlayerModelBadge({})).toBe('AI player');
    expect(getPlayerModelBadge({ aiAssignedModel: 'deepseek-flash' })).toBe('DeepSeek V4.1 Flash');
    expect(getPlayerModelBadge({ aiAssignedModel: 'deepseek-v4-pro', aiDialogueSource: { model: 'local', fallback: true } })).toBe('Local dialogue');
  });
});
