import { describe, expect, it } from 'vitest';
import { createSeatRoutes, getPlayerModelBadge, validateDialogueSource } from './modelRouting';
import { getAvailableExpressionModels, MIXED_POOL_MODEL_IDS } from './modelCatalog';
const available = getAvailableExpressionModels({ default_model: 'gemini-3.6-flash', models: MIXED_POOL_MODEL_IDS.map(id => ({ id, label: id })) });

describe('stable per-seat routing', () => {
  it.each([8, 11])('covers all participating models for %s AI seats independently of difficulty', count => {
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      const routes = createSeatRoutes(count, 'multi-ai-model', difficulty, available);
      expect(new Set(routes)).toEqual(new Set(MIXED_POOL_MODEL_IDS));
      expect(routes).toEqual(Array.from({ length: count }, (_, i) => MIXED_POOL_MODEL_IDS[i % 3]));
    }
  });
  it('copies the verified pool and uses only its available subset', () => {
    const subset = available.map(model => ({ ...model, available: model.id === 'deepseek-v4-pro' }));
    const routes = createSeatRoutes(8, 'multi-ai-model', 'easy', subset);
    subset.forEach(model => { model.available = false; });
    expect(routes).toEqual(Array(8).fill('deepseek-v4-pro'));
    expect(createSeatRoutes(8, 'multi-ai-model', 'hard', subset)).toEqual(Array(8).fill('gemini-2.5-flash'));
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
  it('does not promote a legacy random style to a model badge', () => {
    expect(getPlayerModelBadge({})).toBe('AI player');
    expect(getPlayerModelBadge({ aiAssignedModel: 'deepseek-flash' })).toBe('Assigned DeepSeek V4.1 Flash');
    expect(getPlayerModelBadge({ aiAssignedModel: 'deepseek-v4-pro', aiDialogueSource: { model: 'local', fallback: true } })).toBe('Local dialogue · fallback · Assigned DeepSeek V4 Pro');
  });
});
