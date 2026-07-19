/**
 * useWallet — client-side wallet balance management.
 *
 * Guest users: localStorage-backed (key 'werewolf_wallet').
 * Auth users: Supabase user_coins table, with localStorage fallback on error.
 *
 * Purchase flow:
 * 1. POST to /.netlify/functions/payment-escrow
 * 2. On success: update local state from response
 * 3. On fetch error: test-mode fallback (simulates purchase, updates localStorage)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
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

/** Pack rewards used for test-mode fallback when the escrow function is
 *  unreachable (e.g. local dev without Netlify CLI).
 *  Exported for testing and for CoinStore display. */
export const PACK_REWARDS: Record<string, {
  coins: number;
  coupons: number;
  crystals: number;
  costCents: number;
}> = {
  starter:         { coins: 1000,  coupons:   0, crystals: 0, costCents:   0 },
  'coin-small':    { coins: 5000,  coupons:   0, crystals: 0, costCents: 499 },
  'coin-medium':   { coins: 12000, coupons: 100, crystals: 0, costCents: 999 },
  'coin-large':    { coins: 25000, coupons: 200, crystals: 1, costCents: 1999 },
  'crystal-small': { coins: 0,     coupons:   0, crystals: 5, costCents: 499 },
  'crystal-large': { coins: 0,     coupons:   0, crystals: 15,costCents: 1299 },
  'coupon-bundle': { coins: 3000,  coupons: 500, crystals: 0, costCents: 699 },
  // CoinStore packs (amount + bonus coins)
  'coin-60':       { coins: 120,   coupons:   0, crystals: 0, costCents:  600 },
  'coin-300':      { coins: 330,   coupons:   0, crystals: 0, costCents: 3000 },
  'coin-680':      { coins: 748,   coupons:   0, crystals: 0, costCents: 6800 },
  'coin-1280':     { coins: 1408,  coupons:   0, crystals: 0, costCents: 12800 },
  'coin-3280':     { coins: 3960,  coupons:   0, crystals: 0, costCents: 32800 },
  'coin-6480':     { coins: 8080,  coupons:   0, crystals: 0, costCents: 64800 },
};

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

export const saveLocalWallet = (wallet: LocalWallet): void => {
  try {
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(wallet));
  } catch { /* quota exceeded — silently degrade */ }
};

export const buildOrder = (
  id: string,
  packId: string,
  coins: number,
  coupons: number,
  crystals: number,
  costCents: number,
): CoinOrder => ({
  id,
  packId,
  coins,
  coupons,
  crystals,
  costCents,
  status: 'completed',
  createdAt: new Date().toISOString(),
});

export const applyPurchase = (
  prev: LocalWallet,
  packId: string,
  coins: number,
  coupons: number,
  crystals: number,
  costCents: number,
  orderId?: string,
): LocalWallet => ({
  ...prev,
  coins: prev.coins + coins,
  coupons: prev.coupons + coupons,
  crystals: prev.crystals + crystals,
  totalPurchasedCoins: prev.totalPurchasedCoins + coins,
  orders: [
    buildOrder(
      orderId ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      packId, coins, coupons, crystals, costCents,
    ),
    ...prev.orders,
  ],
});

// ─── Hook ────────────────────────────────────────────────────────────────

export function useWallet(
  session: SupabaseSession | null,
  isGuest: boolean,
): WalletState {
  const [wallet, setWallet] = useState<LocalWallet>(loadLocalWallet);
  const isGuestRef = useRef(isGuest);
  isGuestRef.current = isGuest;

  // ── Bootstrap: load from the correct source ──────────────────────────
  useEffect(() => {
    if (isGuest || !session) {
      setWallet(loadLocalWallet());
      return;
    }

    // Auth user: attempt Supabase, fall back to local cache
    if (!isSupabaseConfigured()) {
      setWallet(loadLocalWallet());
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
      })
      .catch(() => {
        if (cancelled) return;
        setWallet(loadLocalWallet());
      });

    return () => { cancelled = true; };
  }, [session?.user?.id, isGuest]);

  // ── refresh: force-reload from data source ───────────────────────────
  const refresh = useCallback(async () => {
    if (isGuest || !session) {
      setWallet(loadLocalWallet());
      return;
    }

    if (!isSupabaseConfigured()) {
      setWallet(loadLocalWallet());
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
    } catch {
      setWallet(loadLocalWallet());
    }
  }, [session, isGuest]);

  // ── purchase: POST to escrow, fall back to test mode ─────────────────
  const purchase = useCallback(
    async (packId: string): Promise<PurchaseResult> => {
      // Try the real escrow endpoint first
      try {
        const body: Record<string, unknown> = { packId, isGuest };
        if (session) {
          body.accessToken = session.accessToken;
          body.userId = session.user.id;
        }

        const res = await fetch('/.netlify/functions/payment-escrow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            success: boolean;
            orderId?: string;
            coins?: number;
            coupons?: number;
            crystals?: number;
            error?: string;
          };

          if (data.success) {
            const grantCoins = data.coins ?? 0;
            const grantCoupons = data.coupons ?? 0;
            const grantCrystals = data.crystals ?? 0;

            setWallet(prev => {
              const updated = applyPurchase(
                prev, packId, grantCoins, grantCoupons, grantCrystals, 0,
                data.orderId,
              );
              if (isGuestRef.current) saveLocalWallet(updated);
              return updated;
            });

            return {
              success: true,
              orderId: data.orderId,
              coins: grantCoins,
              coupons: grantCoupons,
              crystals: grantCrystals,
            };
          }

          return { success: false, error: data.error ?? '购买失败' };
        }

        throw new Error(`${res.status}`);
      } catch {
        // Network error or function not deployed — test-mode fallback below
      }

      // ── Test-mode fallback ──────────────────────────────────────────
      const rewards = PACK_REWARDS[packId];
      if (!rewards) {
        return { success: false, error: `未知的商品包: ${packId}` };
      }

      setWallet(prev => {
        const updated = applyPurchase(
          prev, packId, rewards.coins, rewards.coupons,
          rewards.crystals, rewards.costCents, undefined,
        );
        if (isGuestRef.current) saveLocalWallet(updated);
        return updated;
      });

      return {
        success: true,
        coins: rewards.coins,
        coupons: rewards.coupons,
        crystals: rewards.crystals,
      };
    },
    [session],
  );

  return {
    coins: wallet.coins,
    coupons: wallet.coupons,
    crystals: wallet.crystals,
    totalPurchasedCoins: wallet.totalPurchasedCoins,
    purchase,
    refresh,
    orders: wallet.orders,
  };
}
