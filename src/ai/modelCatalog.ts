export const AI_EXPRESSION_MODEL_IDS = [
  'gemini-3.6-flash',
  'gemini-2.5-flash',
] as const;

export type AIExpressionModelId = (typeof AI_EXPRESSION_MODEL_IDS)[number];

export interface AIExpressionModel {
  id: AIExpressionModelId;
  label: string;
  description: string;
}

export interface ProviderCapabilities {
  default_model: AIExpressionModelId;
  models: Array<{ id: AIExpressionModelId; label: string }>;
}

// The conservative client default is usable without a server capability proof.
export const DEFAULT_EXPRESSION_MODEL: AIExpressionModelId = 'gemini-2.5-flash';

export const AI_EXPRESSION_MODELS: readonly AIExpressionModel[] = [
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

const DEFAULT_MODEL_CATALOG = AI_EXPRESSION_MODELS.filter(model => model.id === DEFAULT_EXPRESSION_MODEL);

export const isAIExpressionModelId = (value: unknown): value is AIExpressionModelId =>
  typeof value === 'string' && AI_EXPRESSION_MODEL_IDS.includes(value as AIExpressionModelId);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Capability results are atomic: malformed or partial data remains 2.5-only. */
export const getAvailableExpressionModels = (capabilities: unknown): readonly AIExpressionModel[] => {
  if (!isRecord(capabilities) || capabilities.default_model !== 'gemini-3.6-flash' || !Array.isArray(capabilities.models)) {
    return DEFAULT_MODEL_CATALOG;
  }
  const ids = new Set<AIExpressionModelId>();
  for (const model of capabilities.models) {
    if (!isRecord(model) || !isAIExpressionModelId(model.id) || typeof model.label !== 'string') return DEFAULT_MODEL_CATALOG;
    ids.add(model.id);
  }
  return ids.has('gemini-3.6-flash') && ids.has('gemini-2.5-flash') ? AI_EXPRESSION_MODELS : DEFAULT_MODEL_CATALOG;
};

export const getExpressionModel = (id: AIExpressionModelId): AIExpressionModel =>
  AI_EXPRESSION_MODELS.find(model => model.id === id) ?? DEFAULT_MODEL_CATALOG[0];
