-- =============================================================================
-- Coin Escrow Schema
-- =============================================================================
-- Tables for the coin purchase / wallet system (third-party escrow bridge).
--
-- Money path: user → escrow record (coin_orders) → owner settlement.
-- Coins are granted immediately in test/dev mode; in production the escrow
-- function is the single integration point for a real payment provider.
--
-- Run this in the Supabase SQL Editor (coordinator responsibility).
-- The coordinator must also verify that RLS policies are active after running.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. coin_orders — tracks every coin purchase intent
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coin_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_id       text NOT NULL,                       -- e.g. 'coins_680'
  coin_amount   int NOT NULL CHECK (coin_amount > 0),
  bonus_amount  int NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  price_cents   int NOT NULL CHECK (price_cents >= 0),
  currency      text NOT NULL DEFAULT 'CNY',
  status        text NOT NULL DEFAULT 'pending',      -- pending | completed | refunded
  payment_method text,                                -- 'escrow' | 'alipay' | 'wechat' | 'stripe'
  escrow_ref    text,                                 -- external reference (real provider)
  created_at    timestamptz DEFAULT now(),
  completed_at  timestamptz
);

-- Index for querying a user's order history
CREATE INDEX IF NOT EXISTS idx_coin_orders_user_id ON coin_orders(user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. user_coins — per-user wallet balances
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_coins (
  user_id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  coins                 int NOT NULL DEFAULT 0 CHECK (coins >= 0),
  coupons               int NOT NULL DEFAULT 0 CHECK (coupons >= 0),
  crystals              int NOT NULL DEFAULT 0 CHECK (crystals >= 0),
  total_purchased_coins int NOT NULL DEFAULT 0 CHECK (total_purchased_coins >= 0),
  updated_at            timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Row-Level Security
-- ---------------------------------------------------------------------------
-- Users can read their own orders; writes are server-side only (service_role).

ALTER TABLE coin_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own orders"
  ON coin_orders
  FOR SELECT
  USING (auth.uid() = user_id);

ALTER TABLE user_coins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own wallet"
  ON user_coins
  FOR SELECT
  USING (auth.uid() = user_id);

-- NOTE: No INSERT/UPDATE/DELETE policies are created for these tables.
-- All writes go through the Netlify payment-escrow function using the
-- service_role key, which bypasses RLS entirely. This ensures that the
-- frontend (anon key) can never create orders or modify balances directly.
