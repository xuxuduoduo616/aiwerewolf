import { useCallback, useEffect, useState } from 'react';
import {
  claimLobbyActivity,
  claimLobbyBattlePassTier,
  claimLobbyBattlePassTiers,
  contributeToLobbyFaction,
  getLobbyFeatureStorageKey,
  loadLobbyFeatureState,
  saveLobbyFeatureState,
  type LobbyFaction,
  type LobbyFeatureStateV1,
} from '../lobbyFeatures';

interface LobbyFeatureSnapshot {
  storageKey: string;
  state: LobbyFeatureStateV1;
}

export interface UseLobbyFeaturesResult {
  storageKey: string;
  state: LobbyFeatureStateV1;
  claimActivity: (activityId: string) => void;
  contributeToFaction: (faction: LobbyFaction, amount?: number) => void;
  claimBattlePassTier: (tierId: string) => void;
  claimEligibleBattlePassTiers: (tierIds: readonly string[]) => void;
}

export const useLobbyFeatures = (
  userId?: string | null,
  storage?: Storage | null,
): UseLobbyFeaturesResult => {
  const storageKey = getLobbyFeatureStorageKey(userId);
  const readCurrentState = useCallback(
    () => loadLobbyFeatureState(userId, storage),
    [storageKey, storage],
  );

  const [snapshot, setSnapshot] = useState<LobbyFeatureSnapshot>(() => ({
    storageKey,
    state: readCurrentState(),
  }));

  // Resolve a changed identity during render so previous-user state is never exposed.
  const state = snapshot.storageKey === storageKey
    ? snapshot.state
    : readCurrentState();

  useEffect(() => {
    setSnapshot(previous => previous.storageKey === storageKey
      ? previous
      : { storageKey, state: readCurrentState() });
  }, [readCurrentState, storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== storageKey) return;
      setSnapshot({ storageKey, state: readCurrentState() });
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [readCurrentState, storageKey]);

  const updateState = useCallback((transform: (current: LobbyFeatureStateV1) => LobbyFeatureStateV1) => {
    setSnapshot(previous => {
      const current = previous.storageKey === storageKey
        ? previous.state
        : readCurrentState();
      const next = transform(current);

      if (next === current && previous.storageKey === storageKey) return previous;
      if (next !== current) saveLobbyFeatureState(userId, next, storage);
      return { storageKey, state: next };
    });
  }, [readCurrentState, storage, storageKey, userId]);

  const claimActivity = useCallback((activityId: string) => {
    updateState(current => claimLobbyActivity(current, activityId));
  }, [updateState]);

  const contributeToFaction = useCallback((faction: LobbyFaction, amount = 1) => {
    updateState(current => contributeToLobbyFaction(current, faction, amount));
  }, [updateState]);

  const claimBattlePassTier = useCallback((tierId: string) => {
    updateState(current => claimLobbyBattlePassTier(current, tierId));
  }, [updateState]);

  const claimEligibleBattlePassTiers = useCallback((tierIds: readonly string[]) => {
    updateState(current => claimLobbyBattlePassTiers(current, tierIds));
  }, [updateState]);

  return {
    storageKey,
    state,
    claimActivity,
    contributeToFaction,
    claimBattlePassTier,
    claimEligibleBattlePassTiers,
  };
};

export default useLobbyFeatures;
