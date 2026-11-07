import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  claimGuestDailyCheckIn,
  createEmptyGuestEconomyState,
  equipGuestSkin,
  finishGuestTutorial,
  getGuestEconomyStorageKey,
  readGuestEconomyLedgerForPrincipal,
  recordGuestTutorialSkip,
  rewardGuestGame,
  unlockGuestSkin,
  type EconomyMutationResult,
  type GuestEconomyState,
  type LedgerReadResult,
} from '../economy/ledger';

export const ACCOUNT_ECONOMY_UNAVAILABLE = 'Account rewards and cosmetic changes are unavailable until the server economy is enabled.';

type EconomyAction = 'check-in' | 'tutorial-skip' | 'tutorial-finish' | 'game-reward' | 'skin-unlock' | 'skin-equip';
type GuestActionReturn = EconomyMutationResult | Promise<boolean>;
export type EconomyIdentity = 'guest' | 'account';
const GUEST_LEDGER_LOCK = 'aiwerewolf:guest-economy-ledger';

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
  checkIn: () => GuestActionReturn;
  skipTutorial: () => GuestActionReturn;
  finishTutorial: () => GuestActionReturn;
  rewardGame: (gameId: string, won: boolean) => GuestActionReturn;
  unlockSkin: (skinId: string) => GuestActionReturn;
  equipSkin: (skinId: string) => GuestActionReturn;
}

const accountUnavailableResult = (): EconomyMutationResult => ({
  ok: false,
  code: 'account-unavailable',
  state: createEmptyGuestEconomyState(),
});

const missingGuestIdentityResult = (): EconomyMutationResult => ({
  ok: false,
  code: 'invalid-request',
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

export const useGuestEconomy = (isGuest: boolean, guestPrincipalId: string | null = null): UseGuestEconomyResult => {
  const identity: EconomyIdentity = isGuest ? 'guest' : 'account';
  const principal = isGuest ? guestPrincipalId : null;
  const initial = useMemo(
    () => principal ? readGuestEconomyLedgerForPrincipal(principal, undefined, { migrateLegacy: false }) : null,
    [principal],
  );
  const [snapshot, setSnapshot] = useState<{
    principal: string;
    state: GuestEconomyState;
    status: LedgerReadResult['status'];
  } | null>(null);
  const [feedback, setFeedback] = useState<EconomyFeedbackState & { principal: string | null }>({
    identity, principal, message: '',
  });
  const activeScope = useRef<{ principal: string | null } | null>(null);
  useLayoutEffect(() => {
    activeScope.current = { principal };
    return () => { activeScope.current = null; };
  }, [principal]);

  const refresh = useCallback(() => {
    if (!principal) return;
    const scope = activeScope.current;
    if (scope?.principal !== principal) return;
    const sync = (migrateLegacy: boolean) => {
      if (activeScope.current !== scope) return;
      const result = readGuestEconomyLedgerForPrincipal(principal, undefined, { migrateLegacy });
      setSnapshot({ principal, state: result.state, status: migrateLegacy ? result.status : 'corrupt' });
    };
    // The origin-wide lock also serializes the existing one-time legacy copy.
    const locks = navigator.locks;
    if (locks) void locks.request(GUEST_LEDGER_LOCK, () => sync(true)).catch(() => sync(false));
    else sync(false);
  }, [principal]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    setFeedback({ identity, principal, message: '' });
  }, [identity, principal]);

  useEffect(() => {
    if (!principal) return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === getGuestEconomyStorageKey(principal)) refresh();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [principal, refresh]);

  const run = useCallback((
    action: EconomyAction,
    operation: () => EconomyMutationResult,
  ): GuestActionReturn => {
    const publish = (result: EconomyMutationResult) => {
      if (principal) {
        const unavailable = ['ledger-corrupt', 'storage-unavailable', 'write-failed'].includes(result.code);
        setSnapshot({ principal, state: result.state, status: unavailable ? 'corrupt' : 'valid' });
      }
      setFeedback({ identity, principal, message: feedbackForResult(action, result) });
      return result;
    };
    if (!isGuest) return publish(accountUnavailableResult());
    if (!principal) return publish(missingGuestIdentityResult());
    if (typeof window === 'undefined') return publish(operation());

    const scope = activeScope.current;
    if (scope?.principal !== principal) return Promise.resolve(false);
    const unavailable = () => {
      if (activeScope.current === scope) {
        const { state } = readGuestEconomyLedgerForPrincipal(principal, undefined, { migrateLegacy: false });
        publish({ ok: false, code: 'storage-unavailable', state });
      }
      return false;
    };
    const locks = navigator.locks;
    if (!locks) return Promise.resolve(unavailable());
    return locks.request(GUEST_LEDGER_LOCK, () => {
      if (activeScope.current !== scope) return false;
      return publish(operation()).ok;
    }).catch(unavailable);
  }, [identity, isGuest, principal]);

  const checkIn = useCallback(() => run('check-in', () => claimGuestDailyCheckIn(undefined, new Date(), guestPrincipalId ?? undefined)), [guestPrincipalId, run]);
  const skipTutorial = useCallback(() => run('tutorial-skip', () => recordGuestTutorialSkip(undefined, new Date(), guestPrincipalId ?? undefined)), [guestPrincipalId, run]);
  const finishTutorial = useCallback(() => run('tutorial-finish', () => finishGuestTutorial(undefined, new Date(), guestPrincipalId ?? undefined)), [guestPrincipalId, run]);
  const rewardGame = useCallback(
    (gameId: string, won: boolean) => run('game-reward', () => rewardGuestGame(gameId, won, undefined, new Date(), guestPrincipalId ?? undefined)),
    [guestPrincipalId, run],
  );
  const unlockSkin = useCallback((skinId: string) => run('skin-unlock', () => unlockGuestSkin(skinId, undefined, new Date(), guestPrincipalId ?? undefined)), [guestPrincipalId, run]);
  const equipSkin = useCallback((skinId: string) => run('skin-equip', () => equipGuestSkin(skinId, undefined, new Date(), guestPrincipalId ?? undefined)), [guestPrincipalId, run]);

  const current = snapshot?.principal === principal ? snapshot : initial;
  return {
    state: current?.state ?? createEmptyGuestEconomyState(),
    ledgerStatus: isGuest ? current?.status ?? 'corrupt' : 'account',
    isGuestEconomy: isGuest,
    feedback: feedback.principal === principal ? getVisibleEconomyFeedback(identity, feedback) : '',
    clearFeedback: () => setFeedback({ identity, principal, message: '' }),
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
