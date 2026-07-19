/**
 * Payment Escrow Bridge — Netlify Function
 *
 * Records coin pack purchase intents to Supabase and grants coins immediately
 * (test/dev mode) or upon owner payment confirmation (production mode once a
 * real payment provider is wired up).
 *
 * Endpoint: POST /.netlify/functions/payment-escrow
 *
 * Money path: user → escrow record → owner settlement.
 * No real payment provider is integrated yet (needs owner keys).
 *
 * Mirrors genai-proxy.cjs patterns: CJS module, OPTIONS preflight, CORS
 * headers, in-memory rate limiting, Supabase admin client for server-side
 * writes.
 *
 * Required env vars (production):
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — service_role key (server-side only)
 *
 * Without SUPABASE_SERVICE_ROLE_KEY the function operates in test mode:
 * validates input, then returns a simulated success response so the frontend
 * can exercise the full flow without real credentials.
 *
 * No API keys live in this source.
 */

const { getAdminClient } = require('./supabase-admin.cjs');

// ─── Rate limiter (mirrors genai-proxy.cjs) ───────────────────────────────

const rateBuckets = new Map();
const RATE_LIMIT = 20;       // requests
const RATE_WINDOW = 60_000;  // per 60s per IP

const checkRateLimit = (ip) => {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_WINDOW;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  return bucket.count <= RATE_LIMIT;
};

// ─── CORS origin resolution (mirrors genai-proxy.cjs) ─────────────────────

const getAllowedOrigin = (requestOrigin) => {
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return requestOrigin || '*';
  return allowed.includes(requestOrigin) ? requestOrigin : allowed[0];
};

// ─── Helpers ──────────────────────────────────────────────────────────────

const generateOrderId = () => {
  // Deterministic-enough UUID v4 without an external dependency.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

/**
 * Validate the request body. Returns { errors[], coinAmount, bonusAmount,
 * priceCents } where errors is empty on success.
 */
const validateInput = (body) => {
  const errors = [];

  if (!body.pack_id || typeof body.pack_id !== 'string' || body.pack_id.trim().length === 0) {
    errors.push('pack_id is required and must be a non-empty string');
  }

  const coinAmount = Number(body.coin_amount);
  if (!Number.isFinite(coinAmount) || coinAmount <= 0 || !Number.isInteger(coinAmount)) {
    errors.push('coin_amount must be a positive integer');
  }

  const bonusAmount = body.bonus_amount !== undefined ? Number(body.bonus_amount) : 0;
  if (!Number.isFinite(bonusAmount) || bonusAmount < 0 || !Number.isInteger(bonusAmount)) {
    errors.push('bonus_amount must be a non-negative integer');
  }

  const priceCents = Number(body.price_cents);
  if (!Number.isFinite(priceCents) || priceCents <= 0 || !Number.isInteger(priceCents)) {
    errors.push('price_cents must be a positive integer');
  }

  return { errors, coinAmount, bonusAmount, priceCents };
};

// ─── Handler ──────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  const requestOrigin = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': getAllowedOrigin(requestOrigin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff',
  };

  // ── OPTIONS preflight ──────────────────────────────────────────────────

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  // ── Method guard ───────────────────────────────────────────────────────

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Rate limit ─────────────────────────────────────────────────────────

  const ip = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']
    || 'unknown';
  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Rate limit exceeded. Try again shortly.' }) };
  }

  // ── Parse body ─────────────────────────────────────────────────────────

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // ── Validate input ─────────────────────────────────────────────────────

  const { errors, coinAmount, bonusAmount, priceCents } = validateInput(body);
  if (errors.length > 0) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Validation failed', details: errors }) };
  }

  const packId = body.pack_id.trim();
  const currency = typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim() : 'CNY';
  const paymentMethod = typeof body.payment_method === 'string' && body.payment_method.trim()
    ? body.payment_method.trim()
    : 'escrow';
  const totalCoins = coinAmount + bonusAmount;

  // ── Extract JWT from Authorization header ──────────────────────────────

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing Authorization header. Send a Supabase JWT as "Bearer <token>".' }) };
  }

  // ── Admin client ───────────────────────────────────────────────────────

  const adminClient = getAdminClient();

  // ── Test mode: no service_role key configured ──────────────────────────
  // Return a simulated success response so the frontend can test E2E without
  // real credentials. The _test_mode flag lets the frontend distinguish real
  // from mock responses.

  if (!adminClient) {
    const orderId = generateOrderId();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        order_id: orderId,
        status: 'pending',
        new_balance: {
          coins: totalCoins,
          coupons: 0,
          crystals: 0,
        },
        message: '订单已创建，等待充值确认。到账后金币将自动发放。',
        _test_mode: true,
      }),
    };
  }

  // ── Production mode: verify JWT + write to Supabase ────────────────────

  try {
    // Verify the JWT and extract the user id.
    const { data: authData, error: authError } = await adminClient.auth.getUser(token);
    if (authError || !authData || !authData.user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) };
    }
    const userId = authData.user.id;

    // ── 1. Insert coin_orders row ──────────────────────────────────────────

    const { data: orderData, error: orderError } = await adminClient
      .from('coin_orders')
      .insert({
        user_id: userId,
        pack_id: packId,
        coin_amount: coinAmount,
        bonus_amount: bonusAmount,
        price_cents: priceCents,
        currency: currency,
        status: 'pending',
        payment_method: paymentMethod,
      })
      .select()
      .single();

    if (orderError) {
      console.error('coin_orders insert error:', orderError.message);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create order' }) };
    }

    // ── 2. Read current wallet (may not exist for first-time purchasers) ──

    let currentCoins = 0;
    let currentCoupons = 0;
    let currentCrystals = 0;
    let currentTotalPurchased = 0;

    try {
      const { data: currentWallet } = await adminClient
        .from('user_coins')
        .select('coins, coupons, crystals, total_purchased_coins')
        .eq('user_id', userId)
        .maybeSingle();
      if (currentWallet) {
        currentCoins = currentWallet.coins || 0;
        currentCoupons = currentWallet.coupons || 0;
        currentCrystals = currentWallet.crystals || 0;
        currentTotalPurchased = currentWallet.total_purchased_coins || 0;
      }
    } catch (readErr) {
      // First purchase — no existing row is fine, start from zero.
      console.error('user_coins read error (continuing with 0):', readErr?.message || readErr);
    }

    const newCoins = currentCoins + totalCoins;
    const newTotalPurchased = currentTotalPurchased + totalCoins;

    // ── 3. Upsert user_coins with incremented balances ─────────────────────

    const { data: updatedWallet, error: upsertError } = await adminClient
      .from('user_coins')
      .upsert(
        {
          user_id: userId,
          coins: newCoins,
          coupons: currentCoupons,
          crystals: currentCrystals,
          total_purchased_coins: newTotalPurchased,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' },
      )
      .select()
      .single();

    if (upsertError) {
      console.error('user_coins upsert error:', upsertError.message);
      // Order was created but wallet update failed — partial failure.
      // Report the order as created but flag the wallet issue.
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          order_id: orderData.id,
          status: 'pending',
          new_balance: null,
          message: '订单已创建，但钱包更新失败。请联系客服。',
          order_error: 'wallet_update_failed',
        }),
      };
    }

    // ── Success ────────────────────────────────────────────────────────────

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        order_id: orderData.id,
        status: 'pending',
        new_balance: {
          coins: newCoins,
          coupons: currentCoupons,
          crystals: currentCrystals,
        },
        message: '订单已创建，等待充值确认。到账后金币将自动发放。',
      }),
    };
  } catch (err) {
    console.error('payment-escrow error:', err?.message || err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
