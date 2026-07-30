export const AI_EXPRESSION_MODEL_IDS = [
  'gemini-2.5-flash',
  'gpt-5.5',
  'gpt-5.6-luna',
] as const;

export type AIExpressionModelId = (typeof AI_EXPRESSION_MODEL_IDS)[number];

export interface AIExpressionModel {
  id: AIExpressionModelId;
  label: string;
  description: string;
}

export interface ProviderCapabilities {
  default_model: 'gemini-2.5-flash';
  models: Array<{
    id: AIExpressionModelId;
    label: string;
  }>;
}

export const DEFAULT_EXPRESSION_MODEL: AIExpressionModelId = 'gemini-2.5-flash';

export const AI_EXPRESSION_MODELS: readonly AIExpressionModel[] = [
  {
    id: DEFAULT_EXPRESSION_MODEL,
    label: 'Gemini 2.5 Flash',
    description: 'Default dialogue refinement with the existing local fallback chain.',
  },
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    description: 'Optional OpenAI dialogue refinement for this match.',
  },
  {
    id: 'gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    description: 'Optional OpenAI dialogue refinement for this match.',
  },
] as const;

const DEFAULT_MODEL_CATALOG = AI_EXPRESSION_MODELS.slice(0, 1);

export const isAIExpressionModelId = (value: unknown): value is AIExpressionModelId =>
  typeof value === 'string'
  && AI_EXPRESSION_MODEL_IDS.includes(value as AIExpressionModelId);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Capability exposure is deliberately atomic: the two optional OpenAI models
 * are selectable only after the server proves access to both exact IDs.
 * Malformed, partial, or stale data always degrades to the playable default.
 */
export const getAvailableExpressionModels = (
  capabilities: unknown,
): readonly AIExpressionModel[] => {
  if (!isRecord(capabilities) || capabilities.default_model !== DEFAULT_EXPRESSION_MODEL) {
    return DEFAULT_MODEL_CATALOG;
  }
  if (!Array.isArray(capabilities.models)) return DEFAULT_MODEL_CATALOG;

  const ids = new Set<AIExpressionModelId>();
  for (const model of capabilities.models) {
    if (!isRecord(model) || !isAIExpressionModelId(model.id) || typeof model.label !== 'string') {
      return DEFAULT_MODEL_CATALOG;
    }
    ids.add(model.id);
  }

  const hasAtomicOpenAIAccess = ids.has('gpt-5.5') && ids.has('gpt-5.6-luna');
  if (!ids.has(DEFAULT_EXPRESSION_MODEL) || !hasAtomicOpenAIAccess) {
    return DEFAULT_MODEL_CATALOG;
  }

  return AI_EXPRESSION_MODELS;
};

export const getExpressionModel = (id: AIExpressionModelId): AIExpressionModel =>
  AI_EXPRESSION_MODELS.find(model => model.id === id) ?? AI_EXPRESSION_MODELS[0];
