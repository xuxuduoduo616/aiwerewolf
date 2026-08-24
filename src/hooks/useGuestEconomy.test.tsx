import React, { useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GUEST_ECONOMY_STORAGE_KEY } from '../economy/ledger';
import { ACCOUNT_ECONOMY_UNAVAILABLE, useGuestEconomy } from './useGuestEconomy';

const installMemoryStorage = () => {
  const values = new Map<string, string>();
  const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem,
  };
  vi.stubGlobal('localStorage', storage);
  return { values, setItem };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useGuestEconomy identity runtime', () => {
  it('never invokes or persists a guest ledger mutation for an account render', () => {
    const storage = installMemoryStorage();
    const AccountProbe = () => {
      const economy = useGuestEconomy(false);
      const didRun = useRef(false);
      const resultCode = useRef('');
      if (!didRun.current) {
        didRun.current = true;
        resultCode.current = economy.finishTutorial().code;
      }
      return <output>{resultCode.current}|{economy.feedback}</output>;
    };

    const markup = renderToStaticMarkup(<AccountProbe />);
    expect(markup).toContain(`account-unavailable|${ACCOUNT_ECONOMY_UNAVAILABLE}`);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.values.has(GUEST_ECONOMY_STORAGE_KEY)).toBe(false);
  });

  it('hides old guest success synchronously when the runtime crosses into an account', () => {
    const storage = installMemoryStorage();
    let writesBeforeAccountAction = -1;
    let writesAfterAccountAction = -1;

    const IdentityTransitionProbe = () => {
      const [isGuest, setIsGuest] = useState(true);
      const economy = useGuestEconomy(isGuest);
      const phase = useRef(0);
      if (phase.current === 0) {
        phase.current = 1;
        expect(economy.finishTutorial().code).toBe('applied');
        setIsGuest(false);
      } else if (phase.current === 1 && !isGuest) {
        phase.current = 2;
        writesBeforeAccountAction = storage.setItem.mock.calls.length;
        expect(economy.finishTutorial().code).toBe('account-unavailable');
        writesAfterAccountAction = storage.setItem.mock.calls.length;
      }
      return <output data-identity={isGuest ? 'guest' : 'account'}>{economy.feedback}</output>;
    };

    const markup = renderToStaticMarkup(<IdentityTransitionProbe />);
    expect(markup).toContain('data-identity="account"');
    expect(markup).toContain(ACCOUNT_ECONOMY_UNAVAILABLE);
    expect(markup).not.toContain('Guide complete');
    expect(writesBeforeAccountAction).toBe(1);
    expect(writesAfterAccountAction).toBe(1);
  });
});
