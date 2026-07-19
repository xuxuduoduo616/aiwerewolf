# Report: wallet-hook-and-integration

**Status:** Ready for review
**Date:** 2026-07-19

## Summary

Created the `useWallet` hook for client-side wallet balance management and wired it through the entire UI stack (App.tsx -> GlobalShell -> TopStatusBar + CoinStore).

## Changes

### New files

- **`src/hooks/useWallet.ts`** — Wallet hook (`useWallet(session, isGuest)`). Returns `{ coins, coupons, crystals, totalPurchasedCoins, purchase, refresh, orders }`. Guest users use localStorage; auth users query Supabase `user_coins` table with localStorage fallback. Purchase POSTs to `/.netlify/functions/payment-escrow` with test-mode fallback for local development. Exports `PACK_REWARDS`, `loadLocalWallet`, `saveLocalWallet`, `buildOrder`, `applyPurchase` for testing.
- **`src/hooks/useWallet.test.ts`** — 24 unit tests covering: DEFAULT_WALLET, PACK_REWARDS (4 pack types), loadLocalWallet/saveLocalWallet persistence, buildOrder, applyPurchase (accumulation, immutability, order history ordering), edge cases (corrupt JSON, missing fields, non-number values, null orders).

### Modified files

- **`src/services/supabaseClient.ts`** — Added `fetchUserCoins(session)` and `upsertUserCoins(session, coins)` functions for the `user_coins` table (follows existing auth session pattern). New `UserCoins` interface exported.
- **`src/App.tsx`** — Imported and called `useWallet(auth.session, auth.isGuest)`. Passes `wallet.coins/coupons/crystals` to GlobalShell. Wires CoinStore with live wallet balances and `onPurchase` callback that delegates to `wallet.purchase`.
- **`src/components/GlobalShell.tsx`** — Added `coins`, `coupons`, `crystals` props (optional, default 0). Passes them to TopStatusBar. Already had `onNavigateToShop` wired to `onNavigate('shop')`.
- **`src/components/TopStatusBar.tsx`** — Already had `onNavigateToShop` prop from prior partial modification. [+] buttons navigate to shop view.
- **`src/components/CoinStore.tsx`** — Added `onPurchase` prop (wired from wallet). Purchase button calls `onPurchase(packId)` and shows "购买成功" toast on success. Purchase button shows "处理中…" during loading. Added test-mode payment method label.

## Architecture

```
useWallet (src/hooks/useWallet.ts)
  ├── localStorage (key: 'werewolf_wallet')  ← guest & auth fallback
  ├── Supabase user_coins table                ← auth reads
  │     (fetchUserCoins / upsertUserCoins in supabaseClient.ts)
  └── fetch('/.netlify/functions/payment-escrow')  ← purchase (test-mode fallback on error)

Data flow:
  App.tsx → useWallet(session, isGuest)
    ├→ GlobalShell(coins, coupons, crystals)
    │   └→ TopStatusBar(coins, coupons, crystals, onNavigateToShop)
    └→ CoinStore(coins, coupons, crystals, onPurchase)
          └→ onPurchase → wallet.purchase(packId)
              ├→ POST payment-escrow (production)
              └→ PACK_REWARDS lookup (test-mode fallback)
```

## Pack IDs (CoinStore ↔ PACK_REWARDS)

CoinStore packs map to PACK_REWARDS via `coin-{amount}` IDs:
- `coin-60` → 120 coins (60+60 bonus), ¥6
- `coin-300` → 330 coins, ¥30
- `coin-680` → 748 coins, ¥68
- `coin-1280` → 1408 coins, ¥128
- `coin-3280` → 3960 coins, ¥328
- `coin-6480` → 8080 coins, ¥648

Also available: `starter`, `coin-small/medium/large`, `crystal-small/large`, `coupon-bundle`.

## Test results

```
npm run test:run — 387 passed / 5 skipped (30 files), zero regressions
npm run build   — clean build, zero TypeScript errors
```
