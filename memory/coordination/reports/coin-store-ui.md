# Coin Store UI Implementation Report

**Task:** coin-store-ui
**Date:** 2026-07-19
**Status:** Ready for review

## Summary

Replaced the "商店街即将开放" placeholder in App.tsx with a full coin store UI page featuring a hero banner, wallet strip, 6 coin pack cards in a 2-column grid, payment method info card, and gold purchase button. Wired TopStatusBar [+] buttons to navigate to the shop view.

## Changed Files

| File | Change |
|------|--------|
| `src/components/CoinPackCard.tsx` | **NEW** - Individual coin pack card component with amount, price, bonus, badge, and selection highlight |
| `src/components/CoinStore.tsx` | **NEW** - Full store page: hero banner, wallet strip, coin pack grid, payment info, purchase button |
| `src/App.tsx` | Replaced shop placeholder (line ~377) with `<CoinStore coins={12850} coupons={320} crystals={8} />`; added import |
| `src/components/GlobalShell.tsx` | Added `onNavigateToShop={() => onNavigate('shop')}` prop pass-through to TopStatusBar |
| `src/components/TopStatusBar.tsx` | Added optional `onNavigateToShop` callback prop; moved `plusBtn` into component as `<button>` with click handler |
| `src/styles/mobile-shell.css` | Added ~170 lines of store-specific CSS: `.wol-store-*`, `.wol-coin-pack*`, `.wol-store-payment*`, `.wol-store-purchase-btn*` |

## Verification

```
npx tsc --noEmit   : PASS (zero errors)
npm run test:run   : PASS (363 passed / 5 skipped — matches baseline)
npm run build      : PASS (built in 1.00s)
```

## Decisions Made

1. **CoinPackCard as its own component** - Separated from CoinStore for reusability (can be used in other purchase flows later). Accepts a `CoinPackData` interface with amount, price, bonus, and optional badge.

2. **Single `onNavigateToShop` callback** - All three [+] buttons in TopStatusBar navigate to the same shop view. Individual currency-specific navigation is not needed at this stage (the shop shows all currencies).

3. **Toggle selection** - Clicking a selected pack deselects it, matching mobile game UX conventions.

4. **CSS scope** - All new classes use `wol-` prefix, staying within the existing design system. No changes to existing game UI classes.

5. **Badge colors** - "首充双倍" uses amber gradient, "最热门" uses red gradient, "限时" uses purple gradient — visually distinct and readable against the dark background.

6. **Purchase button placeholder** - Shows `alert()` on click; real payment flow will be wired in the `payment-escrow-bridge` card.

7. **Inline SVGs** - All icons are inline SVGs matching the pattern used in TopStatusBar and BottomNav (no external icon library dependencies).

## Acceptance Criteria Check

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Coin store renders when bottom nav "商店街" is active | PASS |
| 2 | Hero banner with store title and subtitle | PASS |
| 3 | Wallet strip showing current coin/coupon/crystal balances | PASS |
| 4 | 6 coin pack cards in 2-column grid with correct amounts, prices, and bonus labels | PASS |
| 5 | "首充双倍" badge on the cheapest pack | PASS |
| 6 | Payment method info card at bottom explaining the escrow flow | PASS |
| 7 | Gold purchase button with selected pack info | PASS |
| 8 | Clicking a pack selects it (visual highlight) | PASS |
| 9 | TopStatusBar [+] buttons navigate to the store | PASS |
| 10 | `npm run test:run` + `npm run build` succeed | PASS |
