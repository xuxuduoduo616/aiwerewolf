import { GAME_MODES } from './constants';
import type { Difficulty, GameConfig } from './types';

export const LOBBY_SUBVIEWS = [
  'home',
  'mode-choice',
  'match-setup',
  'activity',
  'faction-support',
  'battle-pass',
] as const;

export type LobbySubview = (typeof LOBBY_SUBVIEWS)[number];

export interface GameSetup {
  mode: 'single';
  boardId: 'nine-player' | 'twelve-player';
  difficulty: Difficulty;
}

const GAME_SETUP_BOARD_CONFIG_IDS: Record<GameSetup['boardId'], GameConfig['id']> = {
  'nine-player': '9-standard',
  'twelve-player': '12-standard',
};

const GAME_SETUP_DIFFICULTIES: readonly Difficulty[] = ['easy', 'normal', 'hard'];

export const isGameSetup = (value: unknown): value is GameSetup => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GameSetup>;
  return candidate.mode === 'single'
    && (candidate.boardId === 'nine-player' || candidate.boardId === 'twelve-player')
    && GAME_SETUP_DIFFICULTIES.includes(candidate.difficulty as Difficulty);
};

export const mapGameSetupToConfig = (value: unknown): GameConfig | null => {
  if (!isGameSetup(value)) return null;
  const configId = GAME_SETUP_BOARD_CONFIG_IDS[value.boardId];
  return GAME_MODES.find(config => config.id === configId) ?? null;
};

export const LOBBY_FEATURES_VERSION = 1 as const;
export const LOBBY_FEATURES_STORAGE_PREFIX = 'aiwerewolf:lobby-features:v1:';
export const MAX_LOCAL_FACTION_CONTRIBUTION = 999_999_999;

export const LOBBY_FACTIONS = ['gpt', 'gemini', 'claude', 'deepseek'] as const;
export type LobbyFaction = (typeof LOBBY_FACTIONS)[number];

export interface LobbyFeatureStateV1 {
  version: typeof LOBBY_FEATURES_VERSION;
  claimedActivityIds: string[];
  factionContributions: Record<LobbyFaction, number>;
  claimedBattlePassTierIds: string[];
}

const MAX_STORED_CLAIMS = 100;
const MAX_STORED_ID_LENGTH = 256;

export const createDefaultLobbyFeatureState = (): LobbyFeatureStateV1 => ({
  version: LOBBY_FEATURES_VERSION,
  claimedActivityIds: [],
  factionContributions: {
    gpt: 0,
    gemini: 0,
    claude: 0,
    deepseek: 0,
  },
  claimedBattlePassTierIds: [],
});

export const getLobbyFeatureStorageKey = (userId?: string | null): string => {
  const identity = typeof userId === 'string' && userId.trim().length > 0
    ? userId
    : 'guest';
  return `${LOBBY_FEATURES_STORAGE_PREFIX}${identity}`;
};

const getBrowserStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isClaimIdArray = (value: unknown): value is string[] => {
  if (!Array.isArray(value) || value.length > MAX_STORED_CLAIMS) return false;
  return value.every(item => (
    typeof item === 'string'
    && item.trim().length > 0
    && item.length <= MAX_STORED_ID_LENGTH
  ));
};

const isLocalCounter = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isSafeInteger(value)
  && value >= 0
  && value <= MAX_LOCAL_FACTION_CONTRIBUTION;

export const parseLobbyFeatureState = (raw: string): LobbyFeatureStateV1 | null => {
  try {
    const candidate: unknown = JSON.parse(raw);
    if (!isRecord(candidate) || candidate.version !== LOBBY_FEATURES_VERSION) return null;
    if (!isClaimIdArray(candidate.claimedActivityIds)) return null;
    if (!isClaimIdArray(candidate.claimedBattlePassTierIds)) return null;
    if (!isRecord(candidate.factionContributions)) return null;

    const gpt = candidate.factionContributions.gpt;
    const gemini = candidate.factionContributions.gemini;
    const claude = candidate.factionContributions.claude;
    const deepseek = candidate.factionContributions.deepseek;
    if (
      !isLocalCounter(gpt)
      || !isLocalCounter(gemini)
      || !isLocalCounter(claude)
      || !isLocalCounter(deepseek)
    ) return null;

    return {
      version: LOBBY_FEATURES_VERSION,
      claimedActivityIds: [...candidate.claimedActivityIds],
      factionContributions: { gpt, gemini, claude, deepseek },
      claimedBattlePassTierIds: [...candidate.claimedBattlePassTierIds],
    };
  } catch {
    return null;
  }
};

export const loadLobbyFeatureState = (
  userId?: string | null,
  storage?: Storage | null,
): LobbyFeatureStateV1 => {
  const activeStorage = storage === undefined ? getBrowserStorage() : storage;
  if (!activeStorage) return createDefaultLobbyFeatureState();

  try {
    const raw = activeStorage.getItem(getLobbyFeatureStorageKey(userId));
    if (raw === null) return createDefaultLobbyFeatureState();
    return parseLobbyFeatureState(raw) ?? createDefaultLobbyFeatureState();
  } catch {
    return createDefaultLobbyFeatureState();
  }
};

export const saveLobbyFeatureState = (
  userId: string | null | undefined,
  state: LobbyFeatureStateV1,
  storage?: Storage | null,
): boolean => {
  const activeStorage = storage === undefined ? getBrowserStorage() : storage;
  if (!activeStorage) return false;

  try {
    activeStorage.setItem(getLobbyFeatureStorageKey(userId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
};

const appendUniqueClaim = (
  claims: string[],
  claimId: string,
): string[] | null => {
  const normalizedId = claimId.trim();
  if (
    normalizedId.length === 0
    || normalizedId.length > MAX_STORED_ID_LENGTH
    || claims.includes(normalizedId)
    || claims.length >= MAX_STORED_CLAIMS
  ) {
    return null;
  }
  return [...claims, normalizedId];
};

export const claimLobbyActivity = (
  state: LobbyFeatureStateV1,
  activityId: string,
): LobbyFeatureStateV1 => {
  const claimedActivityIds = appendUniqueClaim(state.claimedActivityIds, activityId);
  return claimedActivityIds ? { ...state, claimedActivityIds } : state;
};

export const contributeToLobbyFaction = (
  state: LobbyFeatureStateV1,
  faction: LobbyFaction,
  amount = 1,
): LobbyFeatureStateV1 => {
  if (!Number.isSafeInteger(amount) || amount <= 0) return state;

  const current = state.factionContributions[faction];
  const next = Math.min(MAX_LOCAL_FACTION_CONTRIBUTION, current + amount);
  if (next === current) return state;

  return {
    ...state,
    factionContributions: {
      ...state.factionContributions,
      [faction]: next,
    },
  };
};

export const claimLobbyBattlePassTier = (
  state: LobbyFeatureStateV1,
  tierId: string,
): LobbyFeatureStateV1 => claimLobbyBattlePassTiers(state, [tierId]);

export const claimLobbyBattlePassTiers = (
  state: LobbyFeatureStateV1,
  tierIds: readonly string[],
): LobbyFeatureStateV1 => {
  let claimedBattlePassTierIds = state.claimedBattlePassTierIds;

  for (const tierId of tierIds) {
    const nextClaims = appendUniqueClaim(claimedBattlePassTierIds, tierId);
    if (nextClaims) claimedBattlePassTierIds = nextClaims;
  }

  return claimedBattlePassTierIds === state.claimedBattlePassTierIds
    ? state
    : { ...state, claimedBattlePassTierIds };
};
