import { DEFAULT_EXPRESSION_MODEL, MIXED_POOL_MODEL_IDS, getExpressionModel, type AIExpressionModel, type AIExpressionModelId } from './modelCatalog';
import type { Difficulty, Player } from '../types';

export type RoutedModelId = Exclude<AIExpressionModelId, 'multi-ai-model' | 'deepseek-auto'>;
export interface DialogueSource {
  model: RoutedModelId | 'local' | 'unknown' | 'unavailable';
  fallback: boolean;
}
export const LOCAL_DIALOGUE_SOURCE: DialogueSource = { model: 'local', fallback: true };
export const UNAVAILABLE_DIALOGUE_SOURCE: DialogueSource = { model: 'unavailable', fallback: false };

export const resolveSingleRoute = (model: AIExpressionModelId, difficulty: Difficulty): RoutedModelId => {
  if (model === 'deepseek-auto') return difficulty === 'hard' ? 'deepseek-v4-pro' : 'deepseek-flash';
  return model === 'multi-ai-model' ? DEFAULT_EXPRESSION_MODEL : model;
};

/** The backup can take over, but it only gets initial seats if it is the sole verified route. */
export const getVerifiedMixedRoutes = (available: readonly AIExpressionModel[]): RoutedModelId[] =>
  [...MIXED_POOL_MODEL_IDS, DEFAULT_EXPRESSION_MODEL].filter(id => available.some(model => model.id === id && model.available === true));

export const createSeatRoutes = (count: number, selection: AIExpressionModelId, difficulty: Difficulty,
  available: readonly AIExpressionModel[] = []): (RoutedModelId | undefined)[] => {
  if (selection !== 'multi-ai-model') return Array.from({ length: count }, () => resolveSingleRoute(selection, difficulty));
  const verified = getVerifiedMixedRoutes(available);
  const participating = verified.filter(id => id !== DEFAULT_EXPRESSION_MODEL);
  const routes = participating.length ? participating : verified;
  return Array.from({ length: count }, (_, index) => routes.length ? routes[index % routes.length] : undefined);
};

export const getMixedRouteCandidates = (assigned: RoutedModelId | undefined, verified: readonly RoutedModelId[]): RoutedModelId[] =>
  [...new Set(assigned && verified.includes(assigned) ? [assigned, ...verified] : verified)];

export const isVerifiedRemoteSource = (source: DialogueSource, verified: readonly RoutedModelId[]): source is DialogueSource & { model: RoutedModelId } =>
  source.model !== 'unknown' && source.model !== 'local' && source.model !== 'unavailable' && verified.includes(source.model);

/** Accept only the actual requested route or the documented Gemini fallback. */
export const validateDialogueSource = (requested: RoutedModelId, used: unknown, fallback: unknown): DialogueSource => {
  if (used === 'local-fallback' && fallback === true) return LOCAL_DIALOGUE_SOURCE;
  if (used === requested && fallback === false) return { model: requested, fallback: false };
  if ((requested === 'gemini-3.6-flash' || requested === 'gemini-3.8-flash') && used === 'gemini-2.5-flash' && fallback === true) {
    return { model: 'gemini-2.5-flash', fallback: true };
  }
  return { model: 'unknown', fallback: false };
};

export const getPlayerModelBadge = (player: Pick<Player, 'aiAssignedModel' | 'aiDialogueSource'>): string => {
  const assigned = player.aiAssignedModel && getExpressionModel(player.aiAssignedModel).label;
  const source = player.aiDialogueSource;
  if (!source) return assigned ?? 'AI player';
  if (source.model === 'local') return 'Local dialogue';
  if (source.model === 'unavailable') return 'Dialogue unavailable';
  if (source.model === 'unknown') return 'Unverified dialogue source';
  return getExpressionModel(source.model).label;
};
