import { useMemo } from 'react';
import type { SupabaseSession } from '../types';
import type { AccountCatalogItem, AccountLedgerRow, AccountMutationAction } from '../economy/accountEconomy';
import type { EconomyMutationResult, GuestEconomyEvent } from '../economy/ledger';
import { useAccountEconomy, type UseAccountEconomyOptions } from './useAccountEconomy';
import { useGuestEconomy } from './useGuestEconomy';

export type EconomyActionReturn = EconomyMutationResult | Promise<boolean> | false | void;

export interface EconomyViewState {
  coins: number;
  crystals: number;
  inventory: string[];
  equippedSkinId: string | null;
  checkInStreak: number;
  lastCheckInDay: string | null;
  serverDate: string | null;
  claimedMilestoneDays: number[];
  tutorialSeen: boolean;
  tutorialFinished: boolean;
  guestEvents: GuestEconomyEvent[];
  accountLedger: AccountLedgerRow[];
  accountCatalog: AccountCatalogItem[];
  nextCursor: string | null;
}

export interface UseEconomyResult {
  mode: 'guest' | 'account';
  phase: 'ready' | 'loading' | 'inactive' | 'unavailable' | 'reauthenticate' | 'corrupt' | 'unverified';
  state: EconomyViewState;
  feedback: string;
  statusMessage: string;
  pendingAction: AccountMutationAction | null;
  loadingMore: boolean;
  ledgerCorrupt: boolean;
  mutationsDisabled: boolean;
  refresh: () => void | Promise<boolean>;
  loadMore: () => Promise<boolean>;
  checkIn: () => EconomyActionReturn;
  skipTutorial: () => EconomyActionReturn;
  finishTutorial: () => EconomyActionReturn;
  rewardGame: (gameId: string, won: boolean) => EconomyActionReturn;
  unlockSkin: (skinId: string) => EconomyActionReturn;
  equipSkin: (skinId: string) => EconomyActionReturn;
}

const accountViewState = (account: ReturnType<typeof useAccountEconomy>): EconomyViewState => ({
  coins: account.state.wallet.coins,
  crystals: account.state.wallet.crystals,
  inventory: account.state.inventory
    .filter(item => item.itemKind === 'skin')
    .map(item => `skin:${item.id}`),
  equippedSkinId: account.state.equippedSkinId,
  checkInStreak: account.state.checkIn.streak,
  lastCheckInDay: account.state.checkIn.lastClaimDate,
  serverDate: account.state.checkIn.serverDate || null,
  claimedMilestoneDays: account.state.checkIn.claimedMilestoneDays,
  tutorialSeen: account.state.onboarding.completed,
  tutorialFinished: account.state.onboarding.completed,
  guestEvents: [],
  accountLedger: account.state.ledger,
  accountCatalog: account.state.catalog,
  nextCursor: account.state.nextCursor,
});

export const useEconomy = (
  session: SupabaseSession | null,
  isGuest: boolean,
  accountOptions: UseAccountEconomyOptions = {},
): UseEconomyResult => {
  const guest = useGuestEconomy(isGuest);
  const account = useAccountEconomy(isGuest ? null : session, accountOptions);

  return useMemo(() => {
    if (isGuest) {
      return {
        mode: 'guest' as const,
        phase: 'ready' as const,
        state: {
          coins: guest.state.coins,
          crystals: guest.state.crystals,
          inventory: guest.state.inventory,
          equippedSkinId: guest.state.equippedSkinId,
          checkInStreak: guest.state.checkInStreak,
          lastCheckInDay: guest.state.lastCheckInDay,
          serverDate: null,
          claimedMilestoneDays: guest.state.claimedMilestoneDays,
          tutorialSeen: guest.state.tutorialSeen,
          tutorialFinished: guest.state.tutorialFinished,
          guestEvents: guest.state.events,
          accountLedger: [],
          accountCatalog: [],
          nextCursor: null,
        },
        feedback: guest.feedback,
        statusMessage: guest.ledgerStatus === 'corrupt'
          ? 'Local economy data could not be verified.'
          : '',
        pendingAction: null,
        loadingMore: false,
        ledgerCorrupt: guest.ledgerStatus === 'corrupt',
        mutationsDisabled: guest.ledgerStatus === 'corrupt',
        refresh: guest.refresh,
        loadMore: async () => false,
        checkIn: guest.checkIn,
        skipTutorial: guest.skipTutorial,
        finishTutorial: guest.finishTutorial,
        rewardGame: guest.rewardGame,
        unlockSkin: guest.unlockSkin,
        equipSkin: guest.equipSkin,
      };
    }
    return {
      mode: 'account' as const,
      phase: account.phase,
      state: accountViewState(account),
      feedback: account.feedback,
      statusMessage: account.statusMessage,
      pendingAction: account.pendingAction,
      loadingMore: account.loadingMore,
      ledgerCorrupt: account.phase === 'corrupt',
      mutationsDisabled: account.mutationsDisabled,
      refresh: account.refresh,
      loadMore: account.loadMore,
      checkIn: account.checkIn,
      skipTutorial: account.skipTutorial,
      finishTutorial: account.finishTutorial,
      rewardGame: (_gameId: string, _won: boolean) => account.rewardGame(),
      unlockSkin: account.unlockSkin,
      equipSkin: account.equipSkin,
    };
  }, [account, guest, isGuest]);
};

export default useEconomy;
