import { DEFAULT_EXPRESSION_MODEL, MIXED_POOL_MODEL_IDS, getExpressionModel, type AIExpressionModel, type AIExpressionModelId } from './modelCatalog';
import type { Difficulty, Player } from '../types';

export type RoutedModelId = Exclude<AIExpressionModelId, 'multi-ai-model' | 'deepseek-auto'>;
export interface DialogueSource {
  model: RoutedModelId | 'local' | 'unknown';
  fallback: boolean;
}
export const LOCAL_DIALOGUE_SOURCE: DialogueSource = { model: 'local', fallback: true };

export const resolveSingleRoute = (model: AIExpressionModelId, difficulty: Difficulty): RoutedModelId => {
  if (model === 'deepseek-auto') return difficulty === 'hard' ? 'deepseek-v4-pro' : 'deepseek-flash';
  return model === 'multi-ai-model' ? DEFAULT_EXPRESSION_MODEL : model;
};

/** A copied, ordered pool for this match; capability discovery cannot mutate it. */
export const createSeatRoutes = (count: number, selection: AIExpressionModelId, difficulty: Difficulty,
  available: readonly AIExpressionModel[] = []): RoutedModelId[] => {
  const pool = selection === 'multi-ai-model'
    ? MIXED_POOL_MODEL_IDS.filter(id => available.some(model => model.id === id && model.available === true))
    : [resolveSingleRoute(selection, difficulty)];
  const routes = pool.length ? pool : [DEFAULT_EXPRESSION_MODEL];
  return Array.from({ length: count }, (_, index) => routes[index % routes.length]);
};

/** Accept only the actual requested route or the documented Gemini fallback. */
export const validateDialogueSource = (requested: RoutedModelId, used: unknown, fallback: unknown): DialogueSource => {
  if (used === 'local-fallback' && fallback === true) return LOCAL_DIALOGUE_SOURCE;
  if (used === requested && fallback === false) return { model: requested, fallback: false };
  if (requested === 'gemini-3.6-flash' && used === 'gemini-2.5-flash' && fallback === true) {
    return { model: 'gemini-2.5-flash', fallback: true };
  }
  return { model: 'unknown', fallback: false };
};

export const getPlayerModelBadge = (player: Pick<Player, 'aiAssignedModel' | 'aiDialogueSource'>): string => {
  const assigned = player.aiAssignedModel && getExpressionModel(player.aiAssignedModel).label;
  const source = player.aiDialogueSource;
  if (!source) return assigned ? `Assigned ${assigned}` : 'AI player';
  const actual = source.model === 'local' ? 'Local dialogue'
    : source.model === 'unknown' ? 'Unverified dialogue source' : getExpressionModel(source.model).label;
  return `${actual}${source.fallback ? ' · fallback' : ''}${assigned ? ` · Assigned ${assigned}` : ''}`;
};
