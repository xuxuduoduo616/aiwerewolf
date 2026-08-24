import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_ECONOMY_ENDPOINT,
  ACCOUNT_INTENT_STORAGE_KEY,
  AccountEconomyRequestError,
  accountScope,
  clearAccountIntent,
  getAccountEconomyState,
  getOrCreateAccountIntent,
  intentFingerprint,
  mergeAccountLedgerPage,
  parseAccountEconomyEnvelope,
  postAccountEconomyMutation,
  readAccountIntents,
  stateConfirmsIntent,
  type AccountEconomyState,
} from './accountEconomy';

const LEDGER_ONE = '11111111-1111-4111-8111-111111111111';
const LEDGER_TWO = '00000000-0000-4000-8000-000000000002';

const validEnvelope = () => ({
  data: {
    catalog: [
      {
        id: 'mist-wanderer', name: 'Mist Wanderer', itemKind: 'skin', tier: 'basic',
        currency: 'coins', price: 800, assetKey: 'skins/mist-wanderer', purchaseEnabled: true,
      },
      {
        id: 'bamboo-vigil', name: 'Bamboo Vigil', itemKind: 'skin', tier: 'basic',
        currency: 'coins', price: 1400, assetKey: 'skins/bamboo-vigil', purchaseEnabled: false,
      },
      {
        id: 'avatar-frame:ink-ring', name: 'Ink Ring Avatar Frame', itemKind: 'avatar_frame',
        tier: 'common', currency: null, price: 0, assetKey: 'frames/ink-ring', purchaseEnabled: false,
      },
    ],
    wallet: { coins: 900, crystals: 0 },
    inventory: [{
      id: 'mist-wanderer', name: 'Mist Wanderer', itemKind: 'skin', tier: 'basic',
      assetKey: 'skins/mist-wanderer', source: 'purchase', acquiredAt: '2026-08-24T10:00:00.000Z',
    }],
    equippedSkinId: 'mist-wanderer',
    checkIn: {
      streak: 1,
      lastClaimDate: '2026-08-24',
      serverDate: '2026-08-24',
      claimedMilestoneDays: [7, 30, 90],
    },
    onboarding: { completed: true, completedAt: '2026-08-24T09:00:00.000Z' },
    ledger: [{
      id: LEDGER_ONE,
      currency: 'coins',
      amount: 30,
      balanceAfter: 900,
      eventType: 'check_in',
      referenceId: '2026-08-24',
      createdAt: '2026-08-24T10:00:00.000Z',
    }],
    nextCursor: LEDGER_ONE as string | null,
  },
});

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

const memoryStorage = (initial?: string): Storage => {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(ACCOUNT_INTENT_STORAGE_KEY, initial);
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

describe('account economy runtime parser', () => {
  it('accepts the complete two-currency, catalog, inventory, milestone, ledger and cursor shape', () => {
    const parsed = parseAccountEconomyEnvelope(validEnvelope(), 25);
    expect(parsed).not.toBeNull();
    expect(parsed?.wallet).toEqual({ coins: 900, crystals: 0 });
    expect(parsed?.checkIn.claimedMilestoneDays).toEqual([7, 30, 90]);
    expect(parsed?.inventory.map(item => item.id)).toEqual(['mist-wanderer']);
    expect(parsed?.nextCursor).toBe(LEDGER_ONE);
  });

  it('treats verified server skin economics and copy as authoritative while retaining a renderable local ID', () => {
    const body = validEnvelope();
    Object.assign(body.data.catalog[0], {
      name: 'Server Mist Edition',
      tier: 'premium',
      currency: 'crystals',
      price: 37,
      assetKey: 'server/catalog/mist-v2',
    });
    Object.assign(body.data.inventory[0], {
      name: 'Server Mist Edition',
      tier: 'premium',
      assetKey: 'server/catalog/mist-v2',
    });
    const parsed = parseAccountEconomyEnvelope(body);
    expect(parsed?.catalog[0]).toMatchObject({
      id: 'mist-wanderer',
      name: 'Server Mist Edition',
      tier: 'premium',
      currency: 'crystals',
      price: 37,
    });
  });

  it.each([
    ['missing field', (body: ReturnType<typeof validEnvelope>) => { delete (body.data as Partial<typeof body.data>).wallet; }],
    ['third currency', (body: ReturnType<typeof validEnvelope>) => { (body.data.wallet as Record<string, number>).shards = 4; }],
    ['negative balance', (body: ReturnType<typeof validEnvelope>) => { body.data.wallet.coins = -1; }],
    ['unsafe balance', (body: ReturnType<typeof validEnvelope>) => { body.data.wallet.coins = Number.MAX_SAFE_INTEGER + 1; }],
    ['unknown purchasable catalog item', (body: ReturnType<typeof validEnvelope>) => { body.data.catalog[0].id = 'unknown-skin'; }],
    ['unknown disabled catalog item', (body: ReturnType<typeof validEnvelope>) => { body.data.catalog[1].id = 'unmappable-disabled'; }],
    ['skin without an economic currency', (body: ReturnType<typeof validEnvelope>) => { body.data.catalog[1].currency = null; }],
    ['skin with a frame-only tier', (body: ReturnType<typeof validEnvelope>) => { body.data.catalog[1].tier = 'common'; }],
    ['duplicate catalog', (body: ReturnType<typeof validEnvelope>) => { body.data.catalog.push(clone(body.data.catalog[0])); }],
    ['duplicate inventory', (body: ReturnType<typeof validEnvelope>) => { body.data.inventory.push(clone(body.data.inventory[0])); }],
    ['equipped not owned', (body: ReturnType<typeof validEnvelope>) => { body.data.equippedSkinId = 'bamboo-vigil'; }],
    ['invalid date', (body: ReturnType<typeof validEnvelope>) => { body.data.checkIn.serverDate = '2026-02-30'; }],
    ['missing claimed days', (body: ReturnType<typeof validEnvelope>) => { delete (body.data.checkIn as Partial<typeof body.data.checkIn>).claimedMilestoneDays; }],
    ['unknown milestone', (body: ReturnType<typeof validEnvelope>) => { body.data.checkIn.claimedMilestoneDays = [8]; }],
    ['unsorted milestone', (body: ReturnType<typeof validEnvelope>) => { body.data.checkIn.claimedMilestoneDays = [30, 7]; }],
    ['duplicate milestone', (body: ReturnType<typeof validEnvelope>) => { body.data.checkIn.claimedMilestoneDays = [7, 7]; }],
    ['contradictory onboarding', (body: ReturnType<typeof validEnvelope>) => { body.data.onboarding.completed = false; }],
    ['negative ledger balance', (body: ReturnType<typeof validEnvelope>) => { body.data.ledger[0].balanceAfter = -1; }],
    ['third ledger currency', (body: ReturnType<typeof validEnvelope>) => { body.data.ledger[0].currency = 'shards'; }],
    ['cursor not page tail', (body: ReturnType<typeof validEnvelope>) => { body.data.nextCursor = LEDGER_TWO; }],
  ])('rejects the entire response for %s', (_label, mutate) => {
    const body = validEnvelope();
    mutate(body);
    expect(parseAccountEconomyEnvelope(body, 25)).toBeNull();
  });

  it('rejects duplicate or incorrectly ordered ledger rows and page overflow', () => {
    const duplicate = validEnvelope();
    duplicate.data.ledger.push(clone(duplicate.data.ledger[0]));
    duplicate.data.nextCursor = LEDGER_ONE;
    expect(parseAccountEconomyEnvelope(duplicate, 25)).toBeNull();

    const overflow = validEnvelope();
    overflow.data.ledger.push({
      ...overflow.data.ledger[0],
      id: LEDGER_TWO,
      createdAt: '2026-08-23T10:00:00.000Z',
    });
    overflow.data.nextCursor = LEDGER_TWO;
    expect(parseAccountEconomyEnvelope(overflow, 1)).toBeNull();
  });
});

describe('account economy HTTP transport', () => {
  it('uses the exact same-origin GET path, bearer header and bounded query only', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(validEnvelope()));
    const result = await getAccountEconomyState({ accessToken: 'synthetic-access-value', fetchImpl }, 25);

    expect(result.wallet.coins).toBe(900);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${ACCOUNT_ECONOMY_ENDPOINT}?ledgerLimit=25`);
    expect(init).toMatchObject({ method: 'GET', credentials: 'same-origin' });
    expect(Object.keys(init?.headers as Record<string, string>)).toEqual(['Authorization']);
    expect(String(url)).not.toMatch(/token|user|email/i);
  });

  it('sends exact mutation bodies without user, date, price, reward, balance or result fields', async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse({ data: { accepted: true } });
    });
    const options = { accessToken: 'synthetic-access-value', fetchImpl };
    await postAccountEconomyMutation(options, 'claim_check_in', 'economy:11111111-1111-4111-8111-111111111111');
    await postAccountEconomyMutation(options, 'finish_onboarding', 'economy:22222222-2222-4222-8222-222222222222');
    await postAccountEconomyMutation(options, 'unlock_skin', 'economy:33333333-3333-4333-8333-333333333333', 'mist-wanderer');
    await postAccountEconomyMutation(options, 'equip_skin', 'economy:44444444-4444-4444-8444-444444444444', 'mist-wanderer');

    expect(bodies).toEqual([
      { action: 'claim_check_in', idempotencyKey: expect.any(String) },
      { action: 'finish_onboarding', idempotencyKey: expect.any(String) },
      { action: 'unlock_skin', idempotencyKey: expect.any(String), skinId: 'mist-wanderer' },
      { action: 'equip_skin', idempotencyKey: expect.any(String), skinId: 'mist-wanderer' },
    ]);
    expect(JSON.stringify(bodies)).not.toMatch(/userId|date|price|reward|balance|result|won|completed/i);
    expect(fetchImpl.mock.calls.every(([url]) => url === ACCOUNT_ECONOMY_ENDPOINT)).toBe(true);
  });

  it.each([
    [101, 'ECONOMY_REQUEST_INVALID'],
    [0, 'ECONOMY_REQUEST_INVALID'],
  ])('rejects ledger limit %s before fetch', async (limit, code) => {
    const fetchImpl = vi.fn();
    await expect(getAccountEconomyState({ accessToken: 'synthetic-access-value', fetchImpl }, limit))
      .rejects.toMatchObject({ code });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps HTTP and malformed responses to stable errors without upstream details', async () => {
    const denied = vi.fn(async () => jsonResponse({ code: 'UNAUTHORIZED', detail: 'private sql' }, 401));
    await expect(getAccountEconomyState({ accessToken: 'synthetic-access-value', fetchImpl: denied }))
      .rejects.toEqual(expect.objectContaining({ status: 401, code: 'ECONOMY_REQUEST_FAILED' }));
    const html = vi.fn(async () => new Response('<html>failure</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
    await expect(getAccountEconomyState({ accessToken: 'synthetic-access-value', fetchImpl: html }))
      .rejects.toEqual(expect.objectContaining({ status: 502, code: 'ECONOMY_RESPONSE_INVALID' }));
  });
});

describe('persistent account intent registry', () => {
  it('reuses one key for the same scoped intent across reload-like reads', () => {
    const storage = memoryStorage();
    const scope = accountScope('account-a');
    const fingerprint = intentFingerprint('unlock_skin', 'mist-wanderer');
    const first = getOrCreateAccountIntent(scope, 'unlock_skin', fingerprint, storage, () => 'economy:11111111-1111-4111-8111-111111111111');
    const replay = getOrCreateAccountIntent(scope, 'unlock_skin', fingerprint, storage, () => 'economy:other-never-used');
    expect(first.status).toBe('ready');
    expect(replay).toEqual(first);
    expect(storage.getItem(ACCOUNT_INTENT_STORAGE_KEY)).not.toContain('account-a');
    expect(storage.getItem(ACCOUNT_INTENT_STORAGE_KEY)).not.toMatch(/access|email|balance|reward/i);
  });

  it('uses different keys for confirmed A to B, B to A and future A to B intents', () => {
    const storage = memoryStorage();
    const scope = accountScope('account-a');
    let ordinal = 0;
    const factory = () => `economy:${String(++ordinal).padStart(36, '0')}`;
    const make = (skinId: string) => getOrCreateAccountIntent(
      scope,
      'equip_skin',
      intentFingerprint('equip_skin', skinId),
      storage,
      factory,
    );
    const first = make('bamboo-vigil');
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(clearAccountIntent(first.intent, storage)).toBe(true);
    const second = make('mist-wanderer');
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') return;
    expect(clearAccountIntent(second.intent, storage)).toBe(true);
    const third = make('bamboo-vigil');
    expect(third.status).toBe('ready');
    if (third.status !== 'ready') return;
    expect(new Set([first.intent.requestId, second.intent.requestId, third.intent.requestId]).size).toBe(3);
  });

  it('fails closed for unknown versions, malformed records and cross-scope reuse', () => {
    const corrupt = memoryStorage(JSON.stringify({ version: 2, intents: [] }));
    expect(readAccountIntents(corrupt).status).toBe('corrupt');
    expect(getOrCreateAccountIntent(
      accountScope('a'), 'finish_onboarding', intentFingerprint('finish_onboarding'), corrupt,
    ).status).toBe('corrupt');

    const storage = memoryStorage();
    const first = getOrCreateAccountIntent(
      accountScope('a'), 'finish_onboarding', intentFingerprint('finish_onboarding'), storage,
      () => 'economy:11111111-1111-4111-8111-111111111111',
    );
    const second = getOrCreateAccountIntent(
      accountScope('b'), 'finish_onboarding', intentFingerprint('finish_onboarding'), storage,
      () => 'economy:22222222-2222-4222-8222-222222222222',
    );
    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    if (first.status === 'ready' && second.status === 'ready') {
      expect(first.intent.requestId).not.toBe(second.intent.requestId);
    }
  });

  it('clears only after authoritative state confirms the intended result', () => {
    const parsed = parseAccountEconomyEnvelope(validEnvelope());
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const storage = memoryStorage();
    const created = getOrCreateAccountIntent(
      accountScope('a'), 'equip_skin', intentFingerprint('equip_skin', 'mist-wanderer'), storage,
      () => 'economy:11111111-1111-4111-8111-111111111111',
    );
    expect(created.status).toBe('ready');
    if (created.status !== 'ready') return;
    expect(stateConfirmsIntent(parsed, created.intent, 'bamboo-vigil')).toBe(false);
    expect(readAccountIntents(storage).intents).toHaveLength(1);
    expect(stateConfirmsIntent(parsed, created.intent, 'mist-wanderer')).toBe(true);
    expect(clearAccountIntent(created.intent, storage)).toBe(true);
    expect(readAccountIntents(storage).intents).toHaveLength(0);
  });
});

describe('account ledger pagination merge', () => {
  it('deduplicates overlap, preserves server order and rejects cursor loops', () => {
    const current = parseAccountEconomyEnvelope(validEnvelope());
    expect(current).not.toBeNull();
    if (!current) return;
    const pageBody = validEnvelope();
    pageBody.data.ledger = [{
      ...pageBody.data.ledger[0], id: LEDGER_TWO, createdAt: '2026-08-23T10:00:00.000Z',
    }];
    pageBody.data.nextCursor = null;
    const page = parseAccountEconomyEnvelope(pageBody);
    expect(page).not.toBeNull();
    if (!page) return;
    const merged = mergeAccountLedgerPage(current, page, LEDGER_ONE);
    expect(merged?.ledger.map(row => row.id)).toEqual([LEDGER_ONE, LEDGER_TWO]);
    expect(merged?.nextCursor).toBeNull();
    expect(mergeAccountLedgerPage(current, { ...page, nextCursor: LEDGER_ONE }, LEDGER_ONE)).toBeNull();
  });

  it('rejects a multi-page A to B to A cursor cycle', () => {
    const current = parseAccountEconomyEnvelope(validEnvelope());
    expect(current).not.toBeNull();
    if (!current) return;
    const pageB = parseAccountEconomyEnvelope({ data: {
      ...validEnvelope().data,
      ledger: [{
        ...validEnvelope().data.ledger[0],
        id: LEDGER_TWO,
        createdAt: '2026-08-23T10:00:00.000Z',
      }],
      nextCursor: LEDGER_TWO,
    } });
    expect(pageB).not.toBeNull();
    if (!pageB) return;
    const seen = new Set([LEDGER_ONE]);
    const second = mergeAccountLedgerPage(current, pageB, LEDGER_ONE, seen);
    expect(second?.nextCursor).toBe(LEDGER_TWO);
    seen.add(LEDGER_TWO);
    expect(second && mergeAccountLedgerPage(second, {
      ...pageB,
      ledger: [{ ...current.ledger[0], createdAt: '2026-08-22T10:00:00.000Z' }],
      nextCursor: LEDGER_ONE,
    }, LEDGER_TWO, seen)).toBeNull();
  });
});
