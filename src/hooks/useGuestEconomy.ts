import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  claimGuestDailyCheckIn,
  createEmptyGuestEconomyState,
  equipGuestSkin,
  finishGuestTutorial,
  GUEST_ECONOMY_STORAGE_KEY,
  readGuestEconomyLedger,
  recordGuestTutorialSkip,
  rewardGuestGame,
  unlockGuestSkin,
  type EconomyMutationResult,
  type GuestEconomyState,
  type LedgerReadResult,
} from '../economy/ledger';

export const ACCOUNT_ECONOMY_UNAVAILABLE = 'Account rewards and cosmetic changes are unavailable until the server economy is enabled.';

type EconomyAction = 'check-in' | 'tutorial-skip' | 'tutorial-finish' | 'game-reward' | 'skin-unlock' | 'skin-equip';
export type EconomyIdentity = 'guest' | 'account';

export interface EconomyFeedbackState {
  identity: EconomyIdentity;
  message: string;
}

export interface UseGuestEconomyResult {
  state: GuestEconomyState;
  ledgerStatus: LedgerReadResult['status'] | 'account';
  isGuestEconomy: boolean;
  feedback: string;
  clearFeedback: () => void;
  refresh: () => void;
  checkIn: () => EconomyMutationResult;
  skipTutorial: () => EconomyMutationResult;
  finishTutorial: () => EconomyMutationResult;
  rewardGame: (gameId: string, won: boolean) => EconomyMutationResult;
  unlockSkin: (skinId: string) => EconomyMutationResult;
  equipSkin: (skinId: string) => EconomyMutationResult;
}

const accountUnavailableResult = (): EconomyMutationResult => ({
  ok: false,
  code: 'account-unavailable',
  state: createEmptyGuestEconomyState(),
});

export const runEconomyMutationForIdentity = (
  isGuest: boolean,
  operation: () => EconomyMutationResult,
): EconomyMutationResult => isGuest ? operation() : accountUnavailableResult();

export const getVisibleEconomyFeedback = (
  identity: EconomyIdentity,
  feedback: EconomyFeedbackState,
): string => feedback.identity === identity ? feedback.message : '';

const feedbackForResult = (action: EconomyAction, result: EconomyMutationResult): string => {
  if (result.code === 'account-unavailable') return ACCOUNT_ECONOMY_UNAVAILABLE;
  if (result.code === 'ledger-corrupt') return 'Local economy data could not be verified. No balance or inventory was changed.';
  if (result.code === 'storage-unavailable' || result.code === 'write-failed') return 'Local storage is unavailable. Nothing was changed.';
  if (result.code === 'insufficient-balance') return 'Insufficient balance. Nothing was changed.';
  if (result.code === 'not-owned') return 'This cosmetic is not owned. Nothing was changed.';
  if (result.code === 'already-owned') return 'This cosmetic is already owned.';
  if (result.code === 'invalid-request') return 'The request could not be verified. Nothing was changed.';
  if (result.code === 'already-applied') {
    if (action === 'check-in') return 'Today’s check-in was already recorded.';
    if (action === 'tutorial-finish') return 'The guide reward was already recorded.';
    if (action === 'game-reward') return 'This match result was already recorded.';
    if (action === 'skin-equip') return 'This cosmetic is already equipped.';
    return 'This action was already recorded.';
  }
  switch (action) {
    case 'check-in': return 'Daily check-in recorded.';
    case 'tutorial-skip': return 'Guide skipped. You can reopen it from the lobby.';
    case 'tutorial-finish': return 'Guide complete. 200 Coins were added once.';
    case 'game-reward': return result.event?.delta.coins
      ? `Match reward recorded: ${result.event.delta.coins} Coins.`
      : 'Match completed. The local daily reward cap was already reached.';
    case 'skin-unlock': return 'Cosmetic unlocked.';
    case 'skin-equip': return 'Cosmetic equipped. Gameplay is unchanged.';
  }
};

export const useGuestEconomy = (isGuest: boolean): UseGuestEconomyResult => {
  const identity: EconomyIdentity = isGuest ? 'guest' : 'account';
  const initial = useMemo(
    () => isGuest ? readGuestEconomyLedger() : null,
    // The hook must re-bootstrap only when the auth boundary changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isGuest],
  );
  const [state, setState] = useState<GuestEconomyState>(initial?.state ?? createEmptyGuestEconomyState());
  const [ledgerStatus, setLedgerStatus] = useState<LedgerReadResult['status'] | 'account'>(initial?.status ?? 'account');
  const [feedback, setFeedback] = useState<EconomyFeedbackState>({ identity, message: '' });

  const refresh = useCallback(() => {
    if (!isGuest) {
      setState(createEmptyGuestEconomyState());
      setLedgerStatus('account');
      return;
    }
    const result = readGuestEconomyLedger();
    setState(result.state);
    setLedgerStatus(result.status);
  }, [isGuest]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setFeedback({ identity, message: '' });
  }, [identity]);

  useEffect(() => {
    if (!isGuest || typeof window === 'undefined') return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key === GUEST_ECONOMY_STORAGE_KEY) refresh();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [isGuest, refresh]);

  const run = useCallback((
    action: EconomyAction,
    operation: () => EconomyMutationResult,
  ): EconomyMutationResult => {
    const result = runEconomyMutationForIdentity(isGuest, operation);
    if (isGuest) {
      setState(result.state);
      setLedgerStatus(result.code === 'ledger-corrupt' ? 'corrupt' : 'valid');
    }
    setFeedback({ identity, message: feedbackForResult(action, result) });
    return result;
  }, [identity, isGuest]);

  const checkIn = useCallback(() => run('check-in', () => claimGuestDailyCheckIn()), [run]);
  const skipTutorial = useCallback(() => run('tutorial-skip', () => recordGuestTutorialSkip()), [run]);
  const finishTutorial = useCallback(() => run('tutorial-finish', () => finishGuestTutorial()), [run]);
  const rewardGame = useCallback(
    (gameId: string, won: boolean) => run('game-reward', () => rewardGuestGame(gameId, won)),
    [run],
  );
  const unlockSkin = useCallback((skinId: string) => run('skin-unlock', () => unlockGuestSkin(skinId)), [run]);
  const equipSkin = useCallback((skinId: string) => run('skin-equip', () => equipGuestSkin(skinId)), [run]);

  return {
    state: isGuest ? state : createEmptyGuestEconomyState(),
    ledgerStatus: isGuest ? ledgerStatus : 'account',
    isGuestEconomy: isGuest,
    // Identity-tagging hides a prior guest/account message synchronously, before
    // the boundary-clearing effect runs after commit.
    feedback: getVisibleEconomyFeedback(identity, feedback),
    clearFeedback: () => setFeedback({ identity, message: '' }),
    refresh,
    checkIn,
    skipTutorial,
    finishTutorial,
    rewardGame,
    unlockSkin,
    equipSkin,
  };
};

export default useGuestEconomy;
