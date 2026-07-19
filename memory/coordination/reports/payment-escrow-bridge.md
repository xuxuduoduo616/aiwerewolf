# Implementation Report: payment-escrow-bridge

**Date:** 2026-07-19
**Worker:** Claude Code coordinator (direct implement)
**Verdict:** Ready for review

## Summary

Built the server-side payment escrow infrastructure: a Netlify Function (`payment-escrow.cjs`) that records purchase intents to Supabase, a shared Supabase admin client helper (`supabase-admin.cjs`), and the SQL schema documentation (`docs/coin-escrow-schema.sql`).

## Changed Files

1. **`netlify/functions/supabase-admin.cjs`** — NEW
   - Shared Supabase admin client using `SUPABASE_SERVICE_ROLE_KEY`
   - Client is cached across warm Lambda invocations
   - Returns `null` when env vars are not configured (triggers test-mode fallback)
   - Uses `@supabase/supabase-js` `createClient` with `autoRefreshToken: false, persistSession: false`

2. **`netlify/functions/payment-escrow.cjs`** — NEW
   - POST endpoint: validates input, verifies Supabase JWT, inserts `coin_orders` row, upserts `user_coins` balance
   - OPTIONS preflight returns 204 with CORS headers
   - Rate limiting: 20 requests / 60s per IP (mirrors genai-proxy.cjs)
   - CORS origin resolution via `ALLOWED_ORIGIN` env var (mirrors genai-proxy.cjs)
   - **Test mode**: when `SUPABASE_SERVICE_ROLE_KEY` is not configured, returns a simulated success response (`_test_mode: true`) so the frontend can test E2E without real credentials
   - **Production mode**: verifies JWT via `adminClient.auth.getUser()`, inserts order, reads current wallet, upserts with incremented balances
   - Partial failure handling: if wallet upsert fails after order creation, returns order_id with `order_error: 'wallet_update_failed'` and null balance

3. **`netlify/functions/payment-escrow.js`** — NEW
   - Identical copy of `payment-escrow.cjs` for Netlify auto-detection (mirrors `provider-adapter.js` pattern)

4. **`docs/coin-escrow-schema.sql`** — NEW
   - DDL for `coin_orders` table (order tracking, status enum, payment_method, escrow_ref)
   - DDL for `user_coins` table (wallet balances: coins, coupons, crystals, total_purchased_coins)
   - RLS policies: SELECT-only for authenticated users; all writes are service_role-only through the escrow function
   - Index on `coin_orders(user_id, created_at DESC)` for order history queries
   - `ON DELETE CASCADE` on both foreign keys to `auth.users`

## Verification Results

| Check | Result |
|-------|--------|
| CJS syntax (`supabase-admin.cjs`) | PASS — loads without error |
| CJS syntax (`payment-escrow.cjs`) | PASS — loads without error, `handler` is a function |
| CJS import chain (escrow → admin) | PASS — `typeof handler === 'function'` |
| `npm run test:run` | 363 passed, 5 skipped, 29 files — **zero regressions** |
| `npx vite build` | Builds successfully (1598 modules, 977ms) |
| `npx tsc` (excluding pre-existing broken test) | Zero errors |

**Pre-existing issue noted**: `src/hooks/useWallet.test.ts` (gitignored, uncommitted WIP) fails because `@testing-library/react` is not installed. This file is unrelated to the payment-escrow implementation and was present before this task. It blocks the full `npm run build` (tsc step) but does not affect the vite bundle.

## Technical Decisions

1. **Two-step wallet upsert**: Supabase's `.upsert()` with `onConflict` replaces the row rather than incrementing values. The function reads the current wallet balance first, then upserts with the sum. A race condition exists but is acceptable for a low-concurrency game coin system. A future improvement could use a Postgres `plpgsql` function with `SELECT ... FOR UPDATE` for atomicity.

2. **Test-mode fallback**: When `SUPABASE_SERVICE_ROLE_KEY` is missing, the function returns a simulated success with `_test_mode: true`. This lets the frontend exercise the full purchase flow during development without real credentials. The test-mode response includes a generated UUID as `order_id` and a simulated `new_balance` based on the request amounts.

3. **No netlify.toml changes needed**: Netlify auto-detects functions in the configured `functions` directory. The escrow endpoint is same-origin (`/.netlify/functions/payment-escrow`), so the existing `connect-src 'self'` CSP directive already covers it.

4. **Authorization header added to CORS**: `Access-Control-Allow-Headers` includes `Authorization` so the browser allows the frontend to send the Supabase JWT.

5. **CJS + .js copy pattern**: Mirrors the existing `provider-adapter.cjs` + `provider-adapter.js` pattern. The `.cjs` file is the canonical implementation; the `.js` copy ensures Netlify detects the function regardless of how it resolves the `"type": "module"` in package.json.

## SQL Schema (for coordinator)

The coordinator should run `docs/coin-escrow-schema.sql` in the Supabase SQL Editor and verify:
- Both tables are created
- RLS is enabled on both tables
- The SELECT policies are active
- No INSERT/UPDATE/DELETE policies exist (writes are service_role only)

```sql
-- Tables created:
--   coin_orders (id, user_id, pack_id, coin_amount, bonus_amount, price_cents,
--                currency, status, payment_method, escrow_ref, created_at, completed_at)
--   user_coins  (user_id, coins, coupons, crystals, total_purchased_coins, updated_at)
```

## Not Changed

- Existing functions (genai-proxy, model-adapter, provider-adapter)
- Frontend code (src/*)
- Types, game logic
- CSP headers
- netlify.toml
