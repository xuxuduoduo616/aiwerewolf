import React, { useRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseSession } from '../types';
import { GUEST_ECONOMY_STORAGE_KEY } from '../economy/ledger';
import { useEconomy } from './useEconomy';

const installStorage = () => {
  const values = new Map<string, string>();
  const getItem = vi.fn((key: string) => values.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem,
  };
  vi.stubGlobal('localStorage', storage);
  return { values, getItem, setItem, storage };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useEconomy guest/account isolation', () => {
  it('keeps guest operations local and sends zero economy requests', () => {
    const local = installStorage();
    const fetchImpl = vi.fn();
    const Probe = () => {
      const economy = useEconomy(null, true, { fetchImpl, storage: local.storage });
      const result = useRef('');
      if (!result.current) result.current = String(economy.finishTutorial() && 'guest-finished');
      return <output>{economy.mode}|{result.current}</output>;
    };
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain('guest|guest-finished');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(local.setItem).toHaveBeenCalledWith(GUEST_ECONOMY_STORAGE_KEY, expect.any(String));
  });

  it('never reads guest ledger or old wallet data for an account render', () => {
    const local = installStorage();
    local.values.set(GUEST_ECONOMY_STORAGE_KEY, JSON.stringify({ coins: 999999 }));
    local.values.set('user_coins', '999999');
    const fetchImpl = vi.fn();
    const account: SupabaseSession = {
      accessToken: 'synthetic-account-generation',
      user: { id: 'account-a' },
    };
    const Probe = () => {
      const economy = useEconomy(account, false, { fetchImpl, storage: local.storage });
      return <output>{economy.mode}|{economy.phase}|{economy.state.coins}|{economy.state.guestEvents.length}</output>;
    };
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain('account|loading|0|0');
    expect(local.getItem).not.toHaveBeenCalledWith(GUEST_ECONOMY_STORAGE_KEY);
    expect(local.getItem).not.toHaveBeenCalledWith('user_coins');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns authenticated gameplay reward unavailable with zero network or guest writes', () => {
    const local = installStorage();
    const fetchImpl = vi.fn();
    const account: SupabaseSession = {
      accessToken: 'synthetic-account-generation',
      user: { id: 'account-a' },
    };
    const Probe = () => {
      const economy = useEconomy(account, false, { fetchImpl, storage: local.storage });
      const result = useRef<boolean | null>(null);
      if (result.current === null) result.current = economy.rewardGame('record-id', true) === false;
      return <output>{String(result.current)}|{economy.feedback}</output>;
    };
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain('true|Account match rewards are unavailable');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(local.setItem).not.toHaveBeenCalledWith(GUEST_ECONOMY_STORAGE_KEY, expect.any(String));
  });
});
