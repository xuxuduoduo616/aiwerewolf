# Task: coin-store-ui

## Status

Accepted

## Objective

Build the in-game coin store UI page: hero banner, coin pack cards with pricing, first-time purchase bonus, payment method selector (escrow placeholder), and wallet display. This replaces the "商店街即将开放" placeholder in App.tsx.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `src/App.tsx` (shop view placeholder at line ~377)
- `src/components/TopStatusBar.tsx` (currency display + [+] buttons)
- `src/styles/mobile-shell.css` (design tokens: --wol-gold, --wol-jade, etc.)
- `src/types.ts`

## Context

The coin store is accessed via:
1. Bottom nav "商店街" tab
2. TopStatusBar [+] buttons on each currency

It should follow the same dark Chinese-style mobile game aesthetic as the rest of Cycle 8.

Layout:
1. **Hero banner** at top: "狼村商会" title, "为你的狼村之旅添砖加瓦" subtitle, decorative gold elements
2. **Wallet strip**: current balance of coins/coupons/crystals inline
3. **Coin pack grid** (2-column):
   - Pack cards: coin amount prominently displayed, price in ¥, bonus coins badge, "首充双倍" badge on first pack
   - Hardcoded packs (test data):
     - 60金币 ¥6 (首充双倍 +60)
     - 300金币 ¥30 (+30 bonus)
     - 680金币 ¥68 (+68 bonus, 限时)
     - 1280金币 ¥128 (+128 bonus, 最热门)
     - 3280金币 ¥328 (+680 bonus)
     - 6480金币 ¥648 (+1600 bonus)
4. **Payment method selector** at bottom: "当前支付方式：第三方充值助手（待绑定）" with an info card explaining the escrow flow
5. **Purchase button**: large gold button, disabled state, shows selected pack info

The [+] buttons on TopStatusBar should navigate here (callback passed from App.tsx).

## Allowed changes

- `src/components/CoinStore.tsx` — NEW: full store page component
- `src/components/CoinPackCard.tsx` — NEW: individual coin pack card
- `src/App.tsx` — replace "商店街即将开放" with CoinStore, wire TopStatusBar [+] callbacks
- `src/components/GlobalShell.tsx` — add `onCoinStoreNavigate` prop to pass to TopStatusBar (minimal change)
- `src/components/TopStatusBar.tsx` — accept `onPlusClick` callbacks for each currency
- `src/styles/mobile-shell.css` — add store-specific CSS (coin pack card, hero banner)

## Do not change

- Game logic, existing game components
- BottomNav (already has 商店街 tab)
- TopStatusBar currency display logic (only add click handlers)
- Existing wallet/coin data — use hardcoded values for now (wallet hook comes in payment-escrow-bridge card)

## Acceptance criteria

1. Coin store renders when bottom nav "商店街" is active
2. Hero banner with store title and subtitle
3. Wallet strip showing current coin/coupon/crystal balances
4. 6 coin pack cards in 2-column grid with correct amounts, prices, and bonus labels
5. "首充双倍" badge on the cheapest pack
6. Payment method info card at bottom explaining the escrow flow
7. Gold purchase button with selected pack info
8. Clicking a pack selects it (visual highlight)
9. TopStatusBar [+] buttons navigate to the store
10. `npm run test:run` + `npm run build` succeed

## Verification

```bash
npx tsc --noEmit
npm run test:run
npm run build
```

## Handoff

- Report path: `memory/coordination/reports/coin-store-ui.md`
- Worker must set this card to `Ready for review` or `Blocked`
