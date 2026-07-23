/**
 * useWallet — unit tests for pure wallet logic.
 *
 * Tests all exported pure helpers: loadLocalWallet, saveLocalWallet,
 * buildOrder, applyPurchase, PACK_REWARDS, and DEFAULT_WALLET.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import {
  DEFAULT_WALLET,
  PACK_REWARDS,
  WALLET_STORAGE_KEY,
  loadLocalWallet,
  saveLocalWallet,
  buildOrder,
  applyPurchase,
} from './useWallet';
import type { LocalWallet, CoinOrder } from './useWallet';

// ─── localStorage mock (vitest default env has no DOM) ──────────────────

let store: Record<string, string> = {};

beforeAll(() => {
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    length: 0,
    key: () => null,
  } as Storage;
});

afterAll(() => {
  // @ts-expect-error — clean up mock
  delete globalThis.localStorage;
});

beforeEach(() => {
  store = {};
});

// ─── Helpers ─────────────────────────────────────────────────────────────

const writeStorage = (data: Partial<LocalWallet>) => {
  localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({ ...DEFAULT_WALLET, ...data }));
};

const emptyWallet = (): LocalWallet => ({ ...DEFAULT_WALLET });

// ─── DEFAULT_WALLET ──────────────────────────────────────────────────────

describe('DEFAULT_WALLET', () => {
  it('has zero balances', () => {
    expect(DEFAULT_WALLET.coins).toBe(0);
    expect(DEFAULT_WALLET.coupons).toBe(0);
    expect(DEFAULT_WALLET.crystals).toBe(0);
    expect(DEFAULT_WALLET.totalPurchasedCoins).toBe(0);
    expect(DEFAULT_WALLET.orders).toEqual([]);
  });
});

// ─── PACK_REWARDS ────────────────────────────────────────────────────────

describe('PACK_REWARDS', () => {
  it('coin packs grant correct amounts', () => {
    expect(PACK_REWARDS['coin-small']).toEqual({ coins: 5000, coupons: 0, crystals: 0, costCents: 499 });
    expect(PACK_REWARDS['coin-medium']).toEqual({ coins: 12000, coupons: 100, crystals: 0, costCents: 999 });
    expect(PACK_REWARDS['coin-large']).toEqual({ coins: 25000, coupons: 200, crystals: 1, costCents: 1999 });
  });

  it('crystal packs grant crystals only (no coins)', () => {
    expect(PACK_REWARDS['crystal-small'].coins).toBe(0);
    expect(PACK_REWARDS['crystal-small'].crystals).toBe(5);
    expect(PACK_REWARDS['crystal-large'].coins).toBe(0);
    expect(PACK_REWARDS['crystal-large'].crystals).toBe(15);
  });

  it('starter pack is free (costCents = 0)', () => {
    expect(PACK_REWARDS.starter.costCents).toBe(0);
    expect(PACK_REWARDS.starter.coins).toBe(1000);
    expect(PACK_REWARDS.starter.crystals).toBe(0);
  });

  it('coupon-bundle gives both coins and coupons', () => {
    expect(PACK_REWARDS['coupon-bundle'].coins).toBe(3000);
    expect(PACK_REWARDS['coupon-bundle'].coupons).toBe(500);
    expect(PACK_REWARDS['coupon-bundle'].crystals).toBe(0);
  });
});

// ─── loadLocalWallet / saveLocalWallet ───────────────────────────────────

describe('loadLocalWallet', () => {
  it('returns DEFAULT_WALLET when storage is empty', () => {
    const w = loadLocalWallet();
    expect(w.coins).toBe(0);
    expect(w.coupons).toBe(0);
    expect(w.crystals).toBe(0);
    expect(w.totalPurchasedCoins).toBe(0);
    expect(w.orders).toEqual([]);
  });

  it('reads persisted wallet from localStorage', () => {
    writeStorage({ coins: 12345, coupons: 99, crystals: 7, totalPurchasedCoins: 5000 });
    const w = loadLocalWallet();
    expect(w.coins).toBe(12345);
    expect(w.coupons).toBe(99);
    expect(w.crystals).toBe(7);
    expect(w.totalPurchasedCoins).toBe(5000);
  });

  it('persists orders', () => {
    const order: CoinOrder = {
      id: 'o1', packId: 'coin-small', coins: 5000, coupons: 0,
      crystals: 0, costCents: 499, status: 'completed',
      createdAt: '2025-01-01T00:00:00Z',
    };
    saveLocalWallet({ ...DEFAULT_WALLET, coins: 5000, totalPurchasedCoins: 5000, orders: [order] });

    const w = loadLocalWallet();
    expect(w.orders.length).toBe(1);
    expect(w.orders[0].id).toBe('o1');
    expect(w.orders[0].packId).toBe('coin-small');
  });
});

describe('saveLocalWallet', () => {
  it('writes to localStorage and can be read back', () => {
    const w: LocalWallet = {
      coins: 5000, coupons: 50, crystals: 3,
      totalPurchasedCoins: 10000, orders: [],
    };
    saveLocalWallet(w);

    const raw = localStorage.getItem(WALLET_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.coins).toBe(5000);
    expect(parsed.coupons).toBe(50);
    expect(parsed.totalPurchasedCoins).toBe(10000);
  });
});

// ─── buildOrder ──────────────────────────────────────────────────────────

describe('buildOrder', () => {
  it('creates an order with correct fields', () => {
    const o = buildOrder('order-1', 'coin-medium', 12000, 100, 0, 999);
    expect(o.id).toBe('order-1');
    expect(o.packId).toBe('coin-medium');
    expect(o.coins).toBe(12000);
    expect(o.coupons).toBe(100);
    expect(o.crystals).toBe(0);
    expect(o.costCents).toBe(999);
    expect(o.status).toBe('completed');
    expect(o.createdAt).toBeTruthy();
    // createdAt should be a valid ISO string
    expect(() => new Date(o.createdAt)).not.toThrow();
  });

  it('generates unique ids when called repeatedly', () => {
    const o1 = buildOrder('id1', 'starter', 1000, 0, 0, 0);
    const o2 = buildOrder('id2', 'starter', 1000, 0, 0, 0);
    expect(o1.id).not.toBe(o2.id);
  });
});

// ─── applyPurchase ───────────────────────────────────────────────────────

describe('applyPurchase', () => {
  it('adds coins to balance', () => {
    const prev = emptyWallet();
    const next = applyPurchase(prev, 'coin-small', 5000, 0, 0, 499);
    expect(next.coins).toBe(5000);
    expect(next.coupons).toBe(0);
    expect(next.crystals).toBe(0);
    expect(next.totalPurchasedCoins).toBe(5000);
  });

  it('adds coupons from coupon-bundle', () => {
    const prev = emptyWallet();
    const next = applyPurchase(prev, 'coupon-bundle', 3000, 500, 0, 699);
    expect(next.coins).toBe(3000);
    expect(next.coupons).toBe(500);
  });

  it('adds crystals without changing totalPurchasedCoins', () => {
    const prev = emptyWallet();
    const next = applyPurchase(prev, 'crystal-small', 0, 0, 5, 499);
    expect(next.crystals).toBe(5);
    expect(next.totalPurchasedCoins).toBe(0);
  });

  it('accumulates balances across multiple purchases', () => {
    let w = applyPurchase(emptyWallet(), 'coin-small', 5000, 0, 0, 499);
    w = applyPurchase(w, 'coin-medium', 12000, 100, 0, 999);
    expect(w.coins).toBe(17000);
    expect(w.coupons).toBe(100);
    expect(w.totalPurchasedCoins).toBe(17000);
  });

  it('prepends order to history (newest first)', () => {
    let w = applyPurchase(emptyWallet(), 'coin-small', 5000, 0, 0, 499, 'order-a');
    w = applyPurchase(w, 'coin-large', 25000, 200, 1, 1999, 'order-b');
    expect(w.orders.length).toBe(2);
    expect(w.orders[0].id).toBe('order-b');
    expect(w.orders[1].id).toBe('order-a');
  });

  it('uses provided orderId when given', () => {
    const next = applyPurchase(emptyWallet(), 'starter', 1000, 0, 0, 0, 'escrow-123');
    expect(next.orders[0].id).toBe('escrow-123');
  });

  it('generates a local orderId when not provided', () => {
    const next = applyPurchase(emptyWallet(), 'starter', 1000, 0, 0, 0, undefined);
    expect(next.orders[0].id).toMatch(/^local-\d+/);
  });

  it('does not mutate the previous wallet', () => {
    const prev = emptyWallet();
    const next = applyPurchase(prev, 'coin-small', 5000, 0, 0, 499);
    // prev should remain unchanged
    expect(prev.coins).toBe(0);
    expect(prev.orders.length).toBe(0);
    // next is new
    expect(next.coins).toBe(5000);
  });

  it('totalPurchasedCoins never decreases', () => {
    let w = applyPurchase(emptyWallet(), 'coin-large', 25000, 200, 1, 1999);
    w = applyPurchase(w, 'crystal-small', 0, 0, 5, 499);
    expect(w.totalPurchasedCoins).toBe(25000); // unchanged by crystal pack
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────

describe('wallet edge cases', () => {
  it('loadLocalWallet handles corrupt JSON gracefully', () => {
    localStorage.setItem(WALLET_STORAGE_KEY, 'not-json{{');
    const w = loadLocalWallet();
    expect(w.coins).toBe(0);
    expect(w.orders).toEqual([]);
  });

  it('loadLocalWallet handles missing fields with defaults', () => {
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({ coins: 100 }));
    const w = loadLocalWallet();
    expect(w.coins).toBe(100);
    expect(w.coupons).toBe(0);
    expect(w.crystals).toBe(0);
  });

  it('loadLocalWallet handles non-number coins gracefully', () => {
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({ coins: 'abc' }));
    const w = loadLocalWallet();
    expect(w.coins).toBe(0); // defaults to 0
  });

  it('loadLocalWallet handles null orders gracefully', () => {
    localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify({ coins: 100, orders: null }));
    const w = loadLocalWallet();
    expect(w.orders).toEqual([]);
  });
});
