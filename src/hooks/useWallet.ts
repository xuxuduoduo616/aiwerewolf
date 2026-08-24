/**
 * useWallet — client-side wallet balance management.
 *
 * Existing balances remain readable from the current guest/auth data sources.
 * Purchases are closed until a real payment service and reconciliation path
 * are configured; purchase() is deliberately side-effect free.
 */
import { useState, useEffect, useCallback } from 'react';
import type { SupabaseSession } from '../types';
import {
  isSupabaseConfigured,
  fetchUserCoins,
} from '../services/supabaseClient';

// ─── Types ───────────────────────────────────────────────────────────────

export interface CoinOrder {
  id: string;
  packId: string;
  coins: number;
  coupons: number;
  crystals: number;
  costCents: number;
  status: string;
  createdAt: string;
}

export interface PurchaseResult {
  success: boolean;
  orderId?: string;
  coins?: number;
  coupons?: number;
  crystals?: number;
  error?: string;
}

export interface WalletState {
  coins: number;
  coupons: number;
  crystals: number;
  /** Lifetime total of coins purchased (never decreases). */
  totalPurchasedCoins: number;
  /** Purchase a coin/crystal/coupon pack. */
  purchase: (packId: string) => Promise<PurchaseResult>;
  /** Force-refresh the wallet balance from the data source. */
  refresh: () => Promise<void>;
  /** Order history (newest first). */
  orders: CoinOrder[];
}

export interface LocalWallet {
  coins: number;
  coupons: number;
  crystals: number;
  totalPurchasedCoins: number;
  orders: CoinOrder[];
}

// ─── Constants ───────────────────────────────────────────────────────────

export const WALLET_STORAGE_KEY = 'werewolf_wallet';

export const DEFAULT_WALLET: LocalWallet = {
  coins: 0,
  coupons: 0,
  crystals: 0,
  totalPurchasedCoins: 0,
  orders: [],
};

export const createUnavailableAccountWallet = (): LocalWallet => ({
  ...DEFAULT_WALLET,
  orders: [],
});

/** Stable user-facing result for every purchase attempt while payments close. */
export const PAYMENTS_UNAVAILABLE_ERROR = 'Purchases are currently unavailable.';

export const purchaseUnavailable = async (_packId: string): Promise<PurchaseResult> => ({
  success: false,
  error: PAYMENTS_UNAVAILABLE_ERROR,
});

// ─── Pure helpers (exported for testing) ─────────────────────────────────

export const loadLocalWallet = (): LocalWallet => {
  try {
    const raw = localStorage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_WALLET };
    const parsed: Record<string, unknown> = JSON.parse(raw);
    return {
      coins:                typeof parsed.coins === 'number'                ? parsed.coins : 0,
      coupons:              typeof parsed.coupons === 'number'              ? parsed.coupons : 0,
      crystals:             typeof parsed.crystals === 'number'             ? parsed.crystals : 0,
      totalPurchasedCoins:  typeof parsed.totalPurchasedCoins === 'number'  ? parsed.totalPurchasedCoins : 0,
      orders:               Array.isArray(parsed.orders)                    ? parsed.orders as CoinOrder[] : [],
    };
  } catch {
    return { ...DEFAULT_WALLET };
  }
};

// ─── Hook ────────────────────────────────────────────────────────────────

export function useWallet(
  session: SupabaseSession | null,
  isGuest: boolean,
): WalletState {
  const [wallet, setWallet] = useState<LocalWallet>(() =>
    session && !isGuest ? createUnavailableAccountWallet() : loadLocalWallet());
  const [loadedAccountUserId, setLoadedAccountUserId] = useState<string | null>(null);
  // ── Bootstrap: load from the correct source ──────────────────────────
  useEffect(() => {
    if (isGuest || !session) {
      setWallet(loadLocalWallet());
      setLoadedAccountUserId(null);
      return;
    }

    // Auth user: account balances never fall back to the guest/local cache.
    // Until a verified server response exists, fail closed to zero balances.
    if (!isSupabaseConfigured()) {
      setWallet(createUnavailableAccountWallet());
      setLoadedAccountUserId(null);
      return;
    }

    let cancelled = false;
    fetchUserCoins(session)
      .then(coins => {
        if (cancelled) return;
        setWallet(prev => ({
          ...prev,
          coins: coins.coins,
          coupons: coins.coupons,
          crystals: coins.crystals,
          totalPurchasedCoins: coins.totalPurchasedCoins,
        }));
        setLoadedAccountUserId(session.user.id);
      })
      .catch(() => {
        if (cancelled) return;
        setWallet(createUnavailableAccountWallet());
        setLoadedAccountUserId(null);
      });

    return () => { cancelled = true; };
  }, [session?.user?.id, isGuest]);

  // ── refresh: force-reload from data source ───────────────────────────
  const refresh = useCallback(async () => {
    if (isGuest || !session) {
      setWallet(loadLocalWallet());
      setLoadedAccountUserId(null);
      return;
    }

    if (!isSupabaseConfigured()) {
      setWallet(createUnavailableAccountWallet());
      setLoadedAccountUserId(null);
      return;
    }

    try {
      const coins = await fetchUserCoins(session);
      setWallet(prev => ({
        ...prev,
        coins: coins.coins,
        coupons: coins.coupons,
        crystals: coins.crystals,
        totalPurchasedCoins: coins.totalPurchasedCoins,
      }));
      setLoadedAccountUserId(session.user.id);
    } catch {
      setWallet(createUnavailableAccountWallet());
      setLoadedAccountUserId(null);
    }
  }, [session, isGuest]);

  const visibleWallet = session && !isGuest && loadedAccountUserId !== session.user.id
    ? createUnavailableAccountWallet()
    : wallet;

  return {
    coins: visibleWallet.coins,
    coupons: visibleWallet.coupons,
    crystals: visibleWallet.crystals,
    totalPurchasedCoins: visibleWallet.totalPurchasedCoins,
    purchase: purchaseUnavailable,
    refresh,
    orders: visibleWallet.orders,
  };
}
