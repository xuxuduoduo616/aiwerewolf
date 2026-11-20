export const AI_EXPRESSION_MODEL_IDS = [
  'multi-ai-model',
  'deepseek-auto',
  'deepseek-flash',
  'deepseek-v4-pro',
  'doubao-seed-1.6-flash',
  'doubao-seed-character',
  'doubao-seed-2.1-lite',
  'gemini-3.6-flash',
  'gemini-2.5-flash',
] as const;

export type AIExpressionModelId = (typeof AI_EXPRESSION_MODEL_IDS)[number];

export interface AIExpressionModel {
  id: AIExpressionModelId;
  label: string;
  description: string;
  available?: boolean;
}

export interface ProviderCapabilities {
  default_model: AIExpressionModelId;
  models: Array<{ id: AIExpressionModelId; label: string }>;
  verified_models?: AIExpressionModelId[];
}

// The conservative client default is usable without a server capability proof.
export const MIXED_POOL_MODEL_IDS = [
  'gemini-3.6-flash',
  'deepseek-flash',
  'deepseek-v4-pro',
  'doubao-seed-1.6-flash',
  'doubao-seed-character',
  'doubao-seed-2.1-lite',
] as const;

export const DEFAULT_EXPRESSION_MODEL: 'gemini-2.5-flash' = 'gemini-2.5-flash';

export const AI_EXPRESSION_MODELS: readonly AIExpressionModel[] = [
  { id: 'multi-ai-model', label: 'Multi AI Model', description: 'Stable seat assignments with verified remote alternatives when a model cannot respond.' },
  {
    id: 'deepseek-auto',
    label: 'Automatic · DeepSeek by difficulty',
    description: 'Beginner: Flash · low. Intermediate: Flash · high. Expert: Pro · max.',
  },
  {
    id: 'deepseek-flash',
    label: 'DeepSeek V4.1 Flash',
    description: 'Flash dialogue with low, high, or max reasoning for your difficulty.',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    description: 'Pro dialogue with low, high, or max reasoning for your difficulty.',
  },
  {
    id: 'doubao-seed-1.6-flash',
    label: 'Doubao Seed 1.6 Flash',
    description: 'ByteDance Doubao through Volcano Ark; expression only, no paid reasoning.',
  },
  {
    id: 'doubao-seed-character',
    label: 'Doubao Seed Character',
    description: 'ByteDance Doubao through Volcano Ark; expression only, no paid reasoning.',
  },
  {
    id: 'doubao-seed-2.1-lite',
    label: 'Doubao Seed 2.1 Lite',
    description: 'ByteDance Doubao through Volcano Ark; expression only, no paid reasoning.',
  },
  {
    id: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    description: 'Server-verified primary dialogue refinement.',
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    description: 'Reliable dialogue refinement and safe setup default.',
  },
] as const;

const DEFAULT_MODEL_CATALOG = AI_EXPRESSION_MODELS.filter(model => model.id === 'multi-ai-model' || model.id === DEFAULT_EXPRESSION_MODEL)
  .map(model => ({ ...model, available: false }));

export const isAIExpressionModelId = (value: unknown): value is AIExpressionModelId =>
  typeof value === 'string' && AI_EXPRESSION_MODEL_IDS.includes(value as AIExpressionModelId);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validate the whole envelope; partial supported pools are intentionally usable. */
export const getAvailableExpressionModels = (capabilities: unknown): readonly AIExpressionModel[] => {
  if (!isRecord(capabilities) || !isAIExpressionModelId(capabilities.default_model) || !Array.isArray(capabilities.models)) return DEFAULT_MODEL_CATALOG;
  const ids = new Set<AIExpressionModelId>();
  for (const model of capabilities.models) {
    if (!isRecord(model) || !isAIExpressionModelId(model.id) || typeof model.label !== 'string' || ids.has(model.id)) return DEFAULT_MODEL_CATALOG;
    ids.add(model.id);
  }
  if (!ids.has(capabilities.default_model) || ids.has('multi-ai-model')) return DEFAULT_MODEL_CATALOG;
  if (ids.has('deepseek-auto') && (!ids.has('deepseek-flash') || !ids.has('deepseek-v4-pro'))) return DEFAULT_MODEL_CATALOG;
  // New servers distinguish a conservative fallback from verified remote access.
  if (capabilities.verified_models !== undefined && !Array.isArray(capabilities.verified_models)) return DEFAULT_MODEL_CATALOG;
  const verified = Array.isArray(capabilities.verified_models) ? capabilities.verified_models : [...ids];
  if (verified.some(id => !ids.has(id as AIExpressionModelId)) || new Set(verified).size !== verified.length) return DEFAULT_MODEL_CATALOG;
  return AI_EXPRESSION_MODELS.filter(model => model.id === 'multi-ai-model' || ids.has(model.id))
    .map(model => ({ ...model, available: model.id === 'multi-ai-model'
      ? MIXED_POOL_MODEL_IDS.some(id => verified.includes(id)) : verified.includes(model.id) }));
};
export const getRecommendedExpressionModel = (models: readonly AIExpressionModel[]): AIExpressionModelId =>
  models.some(model => model.id === 'multi-ai-model' && model.available) ? 'multi-ai-model' : DEFAULT_EXPRESSION_MODEL;
export const getExpressionModel = (id: AIExpressionModelId): AIExpressionModel =>
  AI_EXPRESSION_MODELS.find(model => model.id === id) ?? AI_EXPRESSION_MODELS.find(model => model.id === DEFAULT_EXPRESSION_MODEL)!;
