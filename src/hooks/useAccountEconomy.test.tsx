import React, { useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseSession } from '../types';
import {
  ACCOUNT_INTENT_STORAGE_KEY,
  type AccountEconomyState,
} from '../economy/accountEconomy';
import { useAccountEconomy } from './useAccountEconomy';

const session = (id: string, accessToken: string): SupabaseSession => ({
  accessToken,
  user: { id },
});

const storage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
};

afterEach(() => vi.restoreAllMocks());

type HookSlot = {
  value?: unknown;
  deps?: readonly unknown[];
  cleanup?: (() => void) | void;
  effect?: () => void | (() => void);
};

const depsEqual = (left?: readonly unknown[], right?: readonly unknown[]): boolean => {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
};

/** Minimal deterministic React dispatcher that executes this hook's real effects. */
class EffectHookHarness<Props, Result> {
  private readonly slots: HookSlot[] = [];
  private readonly pendingEffects = new Set<number>();
  private index = 0;
  private dirty = false;
  private flushing = false;
  private resultValue!: Result;

  constructor(private readonly hook: (props: Props) => Result, private props: Props) {}

  private readonly dispatcher = {
    useState: <T,>(initial: T | (() => T)) => {
      const index = this.index++;
      const slot = this.slots[index] ?? (this.slots[index] = {});
      if (!('value' in slot)) slot.value = typeof initial === 'function' ? (initial as () => T)() : initial;
      const setState = (next: T | ((previous: T) => T)) => {
        const value = typeof next === 'function' ? (next as (previous: T) => T)(slot.value as T) : next;
        if (Object.is(value, slot.value)) return;
        slot.value = value;
        this.dirty = true;
        queueMicrotask(() => this.flush());
      };
      return [slot.value as T, setState] as const;
    },
    useRef: <T,>(initial: T) => {
      const index = this.index++;
      const slot = this.slots[index] ?? (this.slots[index] = { value: { current: initial } });
      return slot.value as { current: T };
    },
    useMemo: <T,>(factory: () => T, deps?: readonly unknown[]) => {
      const index = this.index++;
      const slot = this.slots[index] ?? (this.slots[index] = {});
      if (!('value' in slot) || !depsEqual(slot.deps, deps)) {
        slot.value = factory();
        slot.deps = deps;
      }
      return slot.value as T;
    },
    useCallback: <T,>(callback: T, deps?: readonly unknown[]) => {
      const index = this.index++;
      const slot = this.slots[index] ?? (this.slots[index] = {});
      if (!('value' in slot) || !depsEqual(slot.deps, deps)) {
        slot.value = callback;
        slot.deps = deps;
      }
      return slot.value as T;
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const index = this.index++;
      const slot = this.slots[index] ?? (this.slots[index] = {});
      if (!depsEqual(slot.deps, deps)) {
        slot.deps = deps;
        slot.effect = effect;
        this.pendingEffects.add(index);
      }
    },
  };

  private render() {
    this.index = 0;
    const internals = (React as unknown as {
      __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
        ReactCurrentDispatcher: { current: unknown };
      };
    }).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    const previous = internals.ReactCurrentDispatcher.current;
    internals.ReactCurrentDispatcher.current = this.dispatcher;
    try {
      this.resultValue = this.hook(this.props);
    } finally {
      internals.ReactCurrentDispatcher.current = previous;
    }
  }

  mount() {
    this.dirty = true;
    this.flush();
  }

  flush() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (let guard = 0; guard < 50 && (this.dirty || this.pendingEffects.size > 0); guard += 1) {
        if (this.dirty) {
          this.dirty = false;
          this.render();
        }
        const effects = [...this.pendingEffects];
        this.pendingEffects.clear();
        for (const index of effects) {
          const slot = this.slots[index];
          slot.cleanup?.();
          slot.cleanup = slot.effect?.();
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  async settle(rounds = 50) {
    for (let index = 0; index < rounds; index += 1) {
      await Promise.resolve();
      this.flush();
    }
  }

  setProps(props: Props) {
    this.props = props;
    this.dirty = true;
    this.flush();
  }

  unmount() {
    for (const slot of this.slots) slot.cleanup?.();
  }

  get result(): Result { return this.resultValue; }
}

const LEDGER_A = '11111111-1111-4111-8111-111111111111';
const LEDGER_B = '00000000-0000-4000-8000-000000000002';

const accountState = (overrides: Partial<AccountEconomyState> = {}): AccountEconomyState => ({
  catalog: [{
    id: 'mist-wanderer', name: 'Server Mist', itemKind: 'skin', tier: 'basic',
    currency: 'coins', price: 875, assetKey: 'server/mist-v2', purchaseEnabled: true,
  }],
  wallet: { coins: 900, crystals: 0 },
  inventory: [{
    id: 'mist-wanderer', name: 'Server Mist', itemKind: 'skin', tier: 'basic',
    assetKey: 'server/mist-v2', source: 'purchase', acquiredAt: '2026-08-23T08:00:00.000Z',
  }],
  equippedSkinId: 'mist-wanderer',
  checkIn: { streak: 6, lastClaimDate: '2026-08-23', serverDate: '2026-08-24', claimedMilestoneDays: [] },
  onboarding: { completed: false, completedAt: null },
  ledger: [{
    id: LEDGER_A, currency: 'coins', amount: 30, balanceAfter: 900,
    eventType: 'check_in', referenceId: 'fixture-a', createdAt: '2026-08-24T08:00:00.000Z',
  }],
  nextCursor: null,
  ...overrides,
});

const envelope = (state = accountState()) => ({ data: state });
const response = (body: unknown, status = 200, contentType = 'application/json') => new Response(
  contentType === 'application/json' ? JSON.stringify(body) : String(body),
  { status, headers: { 'Content-Type': contentType } },
);
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const installWindow = () => {
  vi.stubGlobal('window', { setTimeout, clearTimeout });
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useAccountEconomy render boundary', () => {
  it('is inactive and sends no request without a valid session', () => {
    const fetchImpl = vi.fn();
    const Probe = () => {
      const economy = useAccountEconomy(null, { fetchImpl, storage: storage() });
      return <output>{economy.phase}|{economy.state.wallet.coins}|{economy.statusMessage}</output>;
    };
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain('inactive|0|Sign in to load account economy.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('shows only a zero loading boundary before the first verified GET', () => {
    const fetchImpl = vi.fn();
    const Probe = () => {
      const economy = useAccountEconomy(session('account-a', 'synthetic-generation-a'), {
        fetchImpl,
        storage: storage(),
      });
      return <output>{economy.phase}|{economy.state.wallet.coins}|{economy.state.inventory.length}</output>;
    };
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain('loading|0|0');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('hides prior identity state synchronously on an A to B render transition', () => {
    const sharedStorage = storage();
    const fetchImpl = vi.fn();
    const Probe = () => {
      const [current, setCurrent] = useState(session('account-a', 'synthetic-generation-a'));
      const economy = useAccountEconomy(current, { fetchImpl, storage: sharedStorage });
      const switched = useRef(false);
      if (!switched.current) {
        switched.current = true;
        setCurrent(session('account-b', 'synthetic-generation-b'));
      }
      return <output data-user={current.user.id}>{economy.phase}|{economy.state.wallet.coins}|{economy.feedback}</output>;
    };
    const html = renderToStaticMarkup(<Probe />);
    expect(html).toContain('data-user="account-b"');
    expect(html).toContain('loading|0|');
    expect(html).not.toContain('account-a');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(sharedStorage.getItem(ACCOUNT_INTENT_STORAGE_KEY)).toBeNull();
  });
});

describe('useAccountEconomy live effects and transport behavior', () => {
  const mount = (
    currentSession: SupabaseSession | null,
    fetchImpl: typeof fetch,
    sharedStorage = storage(),
    timeoutMs = 100,
  ) => {
    installWindow();
    const harness = new EffectHookHarness<{
      currentSession: SupabaseSession | null;
    }, ReturnType<typeof useAccountEconomy>>(
      props => useAccountEconomy(props.currentSession, { fetchImpl, storage: sharedStorage, timeoutMs }),
      { currentSession },
    );
    harness.mount();
    return { harness, sharedStorage };
  };

  it('executes the initial GET effect and moves from safe loading to verified ready', async () => {
    let requestSignal: AbortSignal | null = null;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return response(envelope());
    }) as unknown as typeof fetch;
    const { harness } = mount(session('account-a', 'generation-a'), fetchImpl);
    expect(harness.result.phase).toBe('loading');
    expect(harness.result.state.wallet.coins).toBe(0);
    await harness.settle();
    expect(harness.result.phase).toBe('ready');
    expect(harness.result.state.wallet.coins).toBe(900);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(requestSignal).toBeInstanceOf(AbortSignal);
  });

  it('aborts a timed-out GET and exposes a safe unavailable zero view', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | null = null;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as unknown as typeof fetch;
    const { harness } = mount(session('account-a', 'generation-a'), fetchImpl, storage(), 10);
    await vi.advanceTimersByTimeAsync(11);
    await harness.settle();
    expect(Boolean(requestSignal && (requestSignal as AbortSignal).aborted)).toBe(true);
    expect(harness.result.phase).toBe('unavailable');
    expect(harness.result.state.wallet.coins).toBe(0);
  });

  it.each([
    [401, 'reauthenticate'],
    [403, 'unavailable'],
    [404, 'unavailable'],
    [409, 'unavailable'],
    [502, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('maps initial GET HTTP %s to %s without adopting response details', async (status, phase) => {
    const fetchImpl = vi.fn(async () => response({ code: 'SAFE_FAILURE' }, status)) as unknown as typeof fetch;
    const { harness, sharedStorage } = mount(session('account-a', 'generation-a'), fetchImpl);
    await harness.settle();
    expect(harness.result.phase).toBe(phase);
    expect(harness.result.state.wallet).toEqual({ coins: 0, crystals: 0 });
    expect(harness.result.feedback).not.toMatch(/SAFE_FAILURE|sql|token/i);
  });

  it.each([
    ['non-JSON', () => response('<html>bad gateway</html>', 502, 'text/html')],
    ['malformed JSON shape', () => response({ data: { wallet: { coins: 900, crystals: 0 } } })],
    ['third currency', () => response({ data: { ...accountState(), wallet: { coins: 900, crystals: 0, shards: 2 } } })],
    ['equipped contradiction', () => response({ data: { ...accountState(), equippedSkinId: 'bamboo-vigil' } })],
  ])('marks %s as corrupt and clears the entire account view', async (_label, makeResponse) => {
    const fetchImpl = vi.fn(async () => makeResponse()) as unknown as typeof fetch;
    const { harness } = mount(session('account-a', 'generation-a'), fetchImpl);
    await harness.settle();
    expect(harness.result.phase).toBe('corrupt');
    expect(harness.result.state.wallet).toEqual({ coins: 0, crystals: 0 });
    expect(harness.result.state.inventory).toEqual([]);
    expect(harness.result.mutationsDisabled).toBe(true);
  });

  it('coalesces a double check-in and updates only after POST then authoritative GET confirmation', async () => {
    const confirmed = accountState({
      wallet: { coins: 930, crystals: 0 },
      checkIn: { streak: 7, lastClaimDate: '2026-08-24', serverDate: '2026-08-24', claimedMilestoneDays: [7] },
    });
    let ordinal = 0;
    let postCount = 0;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      ordinal += 1;
      if (ordinal === 1) return response(envelope());
      if (init?.method === 'POST') {
        postCount += 1;
        return response({ data: { accepted: true } });
      }
      return response(envelope(confirmed));
    }) as unknown as typeof fetch;
    const { harness } = mount(session('account-a', 'generation-a'), fetchImpl);
    await harness.settle();
    const first = harness.result.checkIn();
    const second = harness.result.checkIn();
    expect(harness.result.state.wallet.coins).toBe(900);
    await Promise.all([first, second]);
    await harness.settle();
    expect(harness.result.phase).toBe('ready');
    expect(harness.result.state.wallet.coins).toBe(930);
    expect(postCount).toBe(1);
    expect(ordinal).toBe(3);
  });

  it('retains one intent key through POST success/GET failure, explicit refresh and retry', async () => {
    const confirmed = accountState({
      wallet: { coins: 930, crystals: 0 },
      checkIn: { streak: 7, lastClaimDate: '2026-08-24', serverDate: '2026-08-24', claimedMilestoneDays: [7] },
    });
    const queue = [
      response(envelope()),
      response({ data: { accepted: true } }),
      response({ code: 'ECONOMY_UNAVAILABLE' }, 503),
      response(envelope()),
      response({ data: { accepted: true } }),
      response(envelope(confirmed)),
    ];
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      const next = queue.shift();
      if (!next) throw new Error('unexpected fetch');
      return next;
    }) as unknown as typeof fetch;
    const { harness, sharedStorage } = mount(session('account-a', 'generation-a'), fetchImpl);
    await harness.settle();
    await expect(harness.result.checkIn()).resolves.toBe(false);
    await harness.settle();
    expect(harness.result.phase).toBe('unverified');
    expect(sharedStorage.getItem(ACCOUNT_INTENT_STORAGE_KEY)).not.toBeNull();
    await expect(harness.result.refresh()).resolves.toBe(true);
    await harness.settle();
    await expect(harness.result.checkIn()).resolves.toBe(true);
    await harness.settle();
    expect(bodies).toHaveLength(2);
    expect(bodies[0].idempotencyKey).toBe(bodies[1].idempotencyKey);
    expect(sharedStorage.getItem(ACCOUNT_INTENT_STORAGE_KEY)).toContain('"intents":[]');
  });

  it.each([
    [401, 'UNAUTHORIZED', 'reauthenticate'],
    [403, 'FORBIDDEN', 'unavailable'],
    [404, 'NOT_FOUND', 'ready'],
    [409, 'IDEMPOTENCY_CONFLICT', 'ready'],
  ] as const)('fails closed for mutation HTTP %s/%s', async (status, code, expectedPhase) => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => (
      init?.method === 'POST' ? response({ code }, status) : response(envelope())
    )) as unknown as typeof fetch;
    const { harness } = mount(session('account-a', 'generation-a'), fetchImpl);
    await harness.settle();
    await expect(harness.result.checkIn()).resolves.toBe(false);
    await harness.settle();
    expect(harness.result.phase).toBe(expectedPhase);
    expect(harness.result.state.wallet.coins).toBe(expectedPhase === 'ready' ? 900 : 0);
    expect(harness.result.feedback).not.toMatch(/sql|token|stack/i);
  });

  it('aborts A and ignores its late GET after switching to B and then logout', async () => {
    const lateA = deferred<Response>();
    const lateB = deferred<Response>();
    const signals: AbortSignal[] = [];
    let requestCount = 0;
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal as AbortSignal);
      requestCount += 1;
      return requestCount === 1 ? lateA.promise : lateB.promise;
    }) as unknown as typeof fetch;
    const { harness } = mount(session('account-a', 'generation-a'), fetchImpl);
    harness.setProps({ currentSession: session('account-b', 'generation-b') });
    expect(signals[0].aborted).toBe(true);
    lateB.resolve(response(envelope(accountState({ wallet: { coins: 222, crystals: 0 } }))));
    await harness.settle();
    expect(harness.result.state.wallet.coins).toBe(222);
    lateA.resolve(response(envelope(accountState({ wallet: { coins: 111, crystals: 0 } }))));
    await harness.settle();
    expect(harness.result.state.wallet.coins).toBe(222);
    harness.setProps({ currentSession: null });
    expect(harness.result.phase).toBe('inactive');
    expect(harness.result.state.wallet.coins).toBe(0);
  });

  it('does not issue a follow-up GET or hydrate B after A has a late POST', async () => {
    const latePost = deferred<Response>();
    const calls: { auth: string; method: string }[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const auth = String((init?.headers as Record<string, string>)?.Authorization ?? '');
      const method = init?.method ?? 'GET';
      calls.push({ auth, method });
      if (calls.length === 1) return response(envelope());
      if (method === 'POST') return latePost.promise;
      return response(envelope(accountState({ wallet: { coins: 222, crystals: 0 } })));
    }) as unknown as typeof fetch;
    const { harness } = mount(session('account-a', 'generation-a'), fetchImpl);
    await harness.settle();
    const mutation = harness.result.checkIn();
    harness.setProps({ currentSession: session('account-b', 'generation-b') });
    await harness.settle();
    latePost.resolve(response({ data: { accepted: true } }));
    await mutation;
    await harness.settle();
    expect(harness.result.state.wallet.coins).toBe(222);
    expect(calls.filter(call => call.auth.includes('generation-a') && call.method === 'GET')).toHaveLength(1);
  });

  it('loads a live second page, preserves order and rejects an A to B to A cursor cycle', async () => {
    const initial = accountState({ nextCursor: LEDGER_A });
    const second = accountState({
      ledger: [{
        id: LEDGER_B, currency: 'coins', amount: 10, balanceAfter: 870,
        eventType: 'onboarding', referenceId: 'fixture-b', createdAt: '2026-08-23T08:00:00.000Z',
      }],
      nextCursor: LEDGER_B,
    });
    const cycle = accountState({
      ledger: [{ ...initial.ledger[0], createdAt: '2026-08-22T08:00:00.000Z' }],
      nextCursor: LEDGER_A,
    });
    const queue = [response(envelope(initial)), response(envelope(second)), response(envelope(cycle))];
    const fetchImpl = vi.fn(async () => queue.shift() ?? response({ code: 'NO_MORE' }, 500)) as unknown as typeof fetch;
    const { harness } = mount(session('account-a', 'generation-a'), fetchImpl);
    await harness.settle();
    await expect(harness.result.loadMore()).resolves.toBe(true);
    await harness.settle();
    expect(harness.result.state.ledger.map(row => row.id)).toEqual([LEDGER_A, LEDGER_B]);
    await expect(harness.result.loadMore()).resolves.toBe(false);
    await harness.settle();
    expect(harness.result.phase).toBe('corrupt');
    expect(harness.result.state.ledger).toEqual([]);
  });

  it('resets the seen-cursor registry on explicit first-page refresh', async () => {
    const initial = accountState({ nextCursor: LEDGER_A });
    const second = accountState({
      ledger: [{
        id: LEDGER_B, currency: 'coins', amount: 10, balanceAfter: 870,
        eventType: 'onboarding', referenceId: 'fixture-b', createdAt: '2026-08-23T08:00:00.000Z',
      }],
      nextCursor: LEDGER_B,
    });
    const queue = [initial, second, initial, second].map(state => response(envelope(state)));
    const fetchImpl = vi.fn(async () => queue.shift() as Response) as unknown as typeof fetch;
    const { harness } = mount(session('account-a', 'generation-a'), fetchImpl);
    await harness.settle();
    await expect(harness.result.loadMore()).resolves.toBe(true);
    await harness.settle();
    await expect(harness.result.refresh()).resolves.toBe(true);
    await harness.settle();
    await expect(harness.result.loadMore()).resolves.toBe(true);
    await harness.settle();
    expect(harness.result.phase).toBe('ready');
    expect(harness.result.state.ledger.map(row => row.id)).toEqual([LEDGER_A, LEDGER_B]);
  });

  it('never writes guest storage during account effects or mutations', async () => {
    const sharedStorage = storage();
    const setItem = vi.spyOn(sharedStorage, 'setItem');
    const confirmed = accountState({
      checkIn: { streak: 7, lastClaimDate: '2026-08-24', serverDate: '2026-08-24', claimedMilestoneDays: [7] },
    });
    const queue = [response(envelope()), response({ data: { accepted: true } }), response(envelope(confirmed))];
    const fetchImpl = vi.fn(async () => queue.shift() as Response) as unknown as typeof fetch;
    const { harness } = mount(session('account-a', 'generation-a'), fetchImpl, sharedStorage);
    await harness.settle();
    await harness.result.checkIn();
    await harness.settle();
    expect(setItem.mock.calls.some(([key]) => key === 'aiwerewolf:economy:v1')).toBe(false);
  });
});
