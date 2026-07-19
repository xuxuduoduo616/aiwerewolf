# Task: wallet-hook-and-integration

## Status

Accepted

## Objective

Create the `useWallet` hook for client-side wallet balance management, wire it into App.tsx, connect the coin store to the escrow function, and tie TopStatusBar balances to live data. This is the final integration card that makes the payment flow end-to-end testable.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `src/App.tsx` (current integration structure after coin-store-ui)
- `src/components/GlobalShell.tsx`
- `src/components/TopStatusBar.tsx`
- `src/components/CoinStore.tsx` (from coin-store-ui)
- `src/services/supabaseClient.ts` (auth patterns)
- `src/hooks/useAuth.ts` (session access pattern)
- `netlify/functions/payment-escrow.cjs` (from payment-escrow-bridge)
- `src/types.ts`

## Context

This card ties together the three layers of the payment system:
1. **Data layer**: `useWallet` hook that reads/writes coin balance via Supabase (for authenticated users) or localStorage (for guests)
2. **Network layer**: client-side fetch to the payment-escrow Netlify function
3. **UI layer**: CoinStore calls the wallet to submit purchases, TopStatusBar reads live balances

Flow:
- User opens store → selects a pack → taps purchase → CoinStore calls `wallet.purchase(packId)` → useWallet POSTs to payment-escrow function → function creates order + grants coins → useWallet refreshes balance → TopStatusBar updates
- For guest users: simulate with localStorage (coins persist across sessions locally)
- For auth users: read from Supabase `user_coins` table

## Allowed changes

- `src/hooks/useWallet.ts` — NEW: wallet hook (balance, purchase, refresh, order history)
- `src/hooks/useWallet.test.ts` — NEW: unit tests for wallet logic
- `src/App.tsx` — integrate useWallet, pass balances to TopStatusBar, wire CoinStore purchase callback
- `src/components/GlobalShell.tsx` — forward wallet-related props
- `src/components/TopStatusBar.tsx` — accept live balance values instead of hardcoded
- `src/components/CoinStore.tsx` — wire purchase button to wallet (if not already done in coin-store-ui)
- `netlify/functions/payment-escrow.cjs` — minor fixes if found during integration testing

## Do not change

- Game logic, existing game components, gameEngine, aiOrchestrator
- Supabase client patterns (extend, don't modify)
- Types in types.ts (add new types in a dedicated section if needed)

## Acceptance criteria

1. `useWallet` hook returns `{ coins, coupons, crystals, purchase, refresh, orders }`
2. `wallet.purchase(packId)` POSTs to payment-escrow, updates balance on success
3. Guest users get localStorage-backed wallet (coins persist locally)
4. TopStatusBar shows live balance from useWallet
5. CoinStore purchase flow: select pack → purchase button → calls wallet.purchase → shows result
6. CoinStore shows "购买成功" toast/snackbar after successful purchase
7. TopStatusBar [+] buttons navigate to shop view in bottom nav
8. Wallet hook exports are unit-tested (useWallet.test.ts)
9. `npm run test:run` passes all tests
10. `npm run build` succeeds

## Verification

```bash
npx tsc --noEmit
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/wallet-hook-and-integration.md`
- Worker must set this card to `Ready for review` or `Blocked`
- This is the integration gate — worker must verify end-to-end flow works locally
