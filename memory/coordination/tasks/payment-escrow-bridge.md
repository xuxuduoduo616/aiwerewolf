# Task: payment-escrow-bridge

## Status

Accepted

## Objective

Build the server-side payment escrow infrastructure: a Netlify Function that records purchase intents to Supabase, a coin order tracking table schema, and a user wallet balance table schema. This is the "第三方充值助手" (third-party escrow bridge) — the money path is user → escrow record → owner settlement. No real payment provider is integrated yet (needs owner keys), but the code path is complete and testable.

## Required reading

- `AGENTS.md`
- `memory/coordination/PROJECT_STATE.md`
- `memory/project-overview.md`
- `src/services/supabaseClient.ts` (existing Supabase client patterns)
- `netlify/functions/genai-proxy.cjs` (existing Netlify function patterns — CJS, CORS, rate limiting)
- `netlify.toml` (function paths, CSP headers)
- `src/types.ts` (existing types)

## Context

We are adding a player coin purchase system. The full money flow is:
1. User selects a coin pack in the store UI
2. Frontend calls the escrow Netlify function: `POST /.netlify/functions/payment-escrow`
3. The function creates a `coin_orders` row with `status='pending'` (escrow)
4. The function also upserts `user_coins` with the granted coins (upon owner confirmation, or immediately for testing)
5. When owner sets up a real payment provider later, the escrow function is the single integration point

The escrow function pattern mirrors the existing genai-proxy.cjs: CJS module, OPTIONS preflight, CORS headers, rate limiting, Supabase admin client.

## Allowed changes

- `netlify/functions/payment-escrow.cjs` — NEW: escrow function (handle coin pack purchases, record to Supabase)
- `netlify/functions/payment-escrow.js` — NEW: same function in ESM wrapper (mirrors provider-adapter.js pattern)
- `netlify/functions/supabase-admin.cjs` — NEW: shared Supabase admin client helper (service_role key for server-side writes)
- `netlify.toml` — add `payment-escrow` function entry IF needed (check if Netlify auto-detects functions/)
- `docs/coin-escrow-schema.sql` — NEW: DDL for `coin_orders` and `user_coins` tables (documentation only — coordinator runs in Supabase Dashboard)

Tables to design:
```sql
-- Tracks every coin purchase intent
CREATE TABLE coin_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  pack_id text NOT NULL,
  coin_amount int NOT NULL CHECK (coin_amount > 0),
  bonus_amount int NOT NULL DEFAULT 0,
  price_cents int NOT NULL,
  currency text NOT NULL DEFAULT 'CNY',
  status text NOT NULL DEFAULT 'pending',  -- pending | completed | refunded
  payment_method text,  -- 'escrow' | 'alipay' | 'wechat' | 'stripe' (owner fills later)
  escrow_ref text,      -- external reference when real provider is connected
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- User wallet balances
CREATE TABLE user_coins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id),
  coins int NOT NULL DEFAULT 0 CHECK (coins >= 0),
  coupons int NOT NULL DEFAULT 0 CHECK (coupons >= 0),
  crystals int NOT NULL DEFAULT 0 CHECK (crystals >= 0),
  total_purchased_coins int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

-- RLS: users can read their own rows
ALTER TABLE coin_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own orders" ON coin_orders FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE user_coins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own wallet" ON user_coins FOR SELECT USING (auth.uid() = user_id);
```

The function accepts:
```json
POST /.netlify/functions/payment-escrow
{
  "pack_id": "coins_680",
  "coin_amount": 680,
  "bonus_amount": 68,
  "price_cents": 600,
  "currency": "CNY",
  "payment_method": "escrow"
}
```

It returns:
```json
{
  "order_id": "uuid",
  "status": "pending",
  "new_balance": { "coins": 748, "coupons": 320, "crystals": 8 },
  "message": "订单已创建，等待充值确认。到账后金币将自动发放。"
}
```

## Do not change

- Existing functions (genai-proxy, model-adapter, provider-adapter)
- Frontend code (src/*)
- Types, game logic
- CSP headers (add connect-src for the escrow endpoint only if needed)

## Acceptance criteria

1. `payment-escrow.cjs` compiles/runs in the Netlify Functions environment
2. Function validates input (required fields, positive amounts)
3. Function inserts into `coin_orders` and upserts `user_coins` via Supabase service_role client
4. Function returns proper CORS headers (mirrors genai-proxy pattern)
5. SQL schema file is complete and documented
6. Function responds to OPTIONS preflight correctly
7. `npm run test:run` + `npm run build` succeed (existing tests unaffected)

## Verification

```bash
npm run test:run
npm run build
node -e "require('./netlify/functions/payment-escrow.cjs')"  # verify CJS syntax
```

## Handoff

- Report path: `memory/coordination/reports/payment-escrow-bridge.md`
- Worker must set this card to `Ready for review` or `Blocked`
- Worker must include the SQL schema in the report
