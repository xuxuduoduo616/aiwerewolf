import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WALLET,
  PAYMENTS_UNAVAILABLE_ERROR,
  WALLET_STORAGE_KEY,
  createUnavailableAccountWallet,
  loadLocalWallet,
  purchaseUnavailable,
} from './useWallet';
import type { LocalWallet } from './useWallet';

let store: Record<string, string> = {};
const getItem = vi.fn((key: string) => store[key] ?? null);
const setItem = vi.fn((key: string, value: string) => { store[key] = value; });
const fetchMock = vi.fn();

beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem,
    setItem,
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
    length: 0,
    key: vi.fn(() => null),
  } as Storage);
  vi.stubGlobal('fetch', fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  store = {};
  getItem.mockClear();
  setItem.mockClear();
  fetchMock.mockReset();
});

const writeExistingWallet = (data: Partial<LocalWallet>) => {
  store[WALLET_STORAGE_KEY] = JSON.stringify({ ...DEFAULT_WALLET, ...data });
  return store[WALLET_STORAGE_KEY];
};

describe('wallet reads', () => {
  it('fails an unavailable account balance closed without reusing the guest cache', () => {
    writeExistingWallet({ coins: 99_999, coupons: 999, crystals: 99 });
    expect(createUnavailableAccountWallet()).toEqual(DEFAULT_WALLET);
    expect(createUnavailableAccountWallet()).not.toEqual(loadLocalWallet());
  });

  it('returns zero balances when no local wallet exists', () => {
    expect(loadLocalWallet()).toEqual(DEFAULT_WALLET);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('reads an existing wallet and order history without writing it', () => {
    const before = writeExistingWallet({
      coins: 12345,
      coupons: 99,
      crystals: 7,
      totalPurchasedCoins: 5000,
      orders: [{
        id: 'existing-order',
        packId: 'coin-60',
        coins: 120,
        coupons: 0,
        crystals: 0,
        costCents: 600,
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
    });

    const wallet = loadLocalWallet();

    expect(wallet).toMatchObject({ coins: 12345, coupons: 99, crystals: 7 });
    expect(wallet.orders).toHaveLength(1);
    expect(store[WALLET_STORAGE_KEY]).toBe(before);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('fails safely on malformed local data without repairing or replacing it', () => {
    store[WALLET_STORAGE_KEY] = 'not-json{{';

    expect(loadLocalWallet()).toEqual(DEFAULT_WALLET);
    expect(store[WALLET_STORAGE_KEY]).toBe('not-json{{');
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('purchaseUnavailable', () => {
  const unavailable = { success: false, error: PAYMENTS_UNAVAILABLE_ERROR };

  it.each([
    ['known pack', 'coin-60'],
    ['unknown pack', 'unknown-pack'],
    ['empty pack id', ''],
    ['malformed runtime value', null as unknown as string],
  ])('returns the same stable failure for %s', async (_label, packId) => {
    expect(await purchaseUnavailable(packId)).toEqual(unavailable);
  });

  it('does not fetch, persist, create an order, or change a cached balance', async () => {
    const before = writeExistingWallet({
      coins: Number.MAX_SAFE_INTEGER,
      totalPurchasedCoins: Number.MAX_SAFE_INTEGER,
      orders: [],
    });
    fetchMock.mockRejectedValue(new Error('network unavailable'));

    const results = await Promise.all([
      purchaseUnavailable('coin-60'),
      purchaseUnavailable('coin-680'),
      purchaseUnavailable('coin-60'),
    ]);

    expect(results).toEqual([unavailable, unavailable, unavailable]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(store[WALLET_STORAGE_KEY]).toBe(before);
  });

  it('ignores a would-be pending endpoint response because no request is made', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'pending', new_balance: { coins: 999999 } }),
    });

    expect(await purchaseUnavailable('coin-60')).toEqual(unavailable);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});
