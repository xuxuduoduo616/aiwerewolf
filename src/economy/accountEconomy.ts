import { SKIN_CATALOG_BY_ID, type EconomyCurrency } from './catalog';

export const ACCOUNT_ECONOMY_ENDPOINT = '/.netlify/functions/economy';
export const ACCOUNT_INTENT_STORAGE_KEY = 'aiwerewolf:economy:account:v1:intents';
export const ACCOUNT_INTENT_VERSION = 1;
export const DEFAULT_ACCOUNT_LEDGER_LIMIT = 25;
export const MAX_ACCOUNT_LEDGER_LIMIT = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[a-z0-9][a-z0-9_:-]{0,127}$/;
const ASSET_KEY = /^[a-z0-9][a-z0-9/_-]{0,127}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/;
const ALLOWED_MILESTONES = [7, 14, 30, 60, 90] as const;
const LEDGER_EVENTS = new Set([
  'check_in', 'check_in_milestone', 'onboarding', 'gameplay_reward', 'skin_unlock',
]);
const KNOWN_FRAMES = new Set(['avatar-frame:ink-ring', 'avatar-frame:crimson-moon']);

export type AccountEconomyPhase =
  | 'inactive'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'reauthenticate'
  | 'corrupt'
  | 'unverified';

export interface AccountCatalogItem {
  id: string;
  name: string;
  itemKind: 'skin' | 'avatar_frame';
  tier: 'basic' | 'premium' | 'common' | 'rare';
  currency: EconomyCurrency | null;
  price: number;
  assetKey: string;
  purchaseEnabled: boolean;
}

export interface AccountInventoryItem {
  id: string;
  name: string;
  itemKind: 'skin' | 'avatar_frame';
  tier: AccountCatalogItem['tier'];
  assetKey: string;
  source: 'purchase' | 'check_in_milestone';
  acquiredAt: string;
}

export interface AccountLedgerRow {
  id: string;
  currency: EconomyCurrency;
  amount: number;
  balanceAfter: number;
  eventType: string;
  referenceId: string;
  createdAt: string;
}

export interface AccountEconomyState {
  catalog: AccountCatalogItem[];
  wallet: { coins: number; crystals: number };
  inventory: AccountInventoryItem[];
  equippedSkinId: string | null;
  checkIn: {
    streak: number;
    lastClaimDate: string | null;
    serverDate: string;
    claimedMilestoneDays: number[];
  };
  onboarding: { completed: boolean; completedAt: string | null };
  ledger: AccountLedgerRow[];
  nextCursor: string | null;
}

export type AccountMutationAction =
  | 'claim_check_in'
  | 'finish_onboarding'
  | 'unlock_skin'
  | 'equip_skin';

export interface AccountIntent {
  version: typeof ACCOUNT_INTENT_VERSION;
  scope: string;
  action: AccountMutationAction;
  fingerprint: string;
  requestId: string;
}

interface AccountIntentEnvelope {
  version: typeof ACCOUNT_INTENT_VERSION;
  intents: AccountIntent[];
}

export type IntentReadResult =
  | { status: 'valid'; intents: AccountIntent[] }
  | { status: 'missing'; intents: [] }
  | { status: 'corrupt'; intents: [] };

export class AccountEconomyRequestError extends Error {
  readonly status: number | null;
  readonly code: string;

  constructor(status: number | null, code: string) {
    super(code);
    this.name = 'AccountEconomyRequestError';
    this.status = status;
    this.code = code;
  }
}

export const createEmptyAccountEconomyState = (): AccountEconomyState => ({
  catalog: [],
  wallet: { coins: 0, crystals: 0 },
  inventory: [],
  equippedSkinId: null,
  checkIn: { streak: 0, lastClaimDate: null, serverDate: '', claimedMilestoneDays: [] },
  onboarding: { completed: false, completedAt: null },
  ledger: [],
  nextCursor: null,
});

const isRecord = (value: unknown): value is Record<string, unknown> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};
const isSafeNonNegative = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
);
const isSafeDelta = (value: unknown): value is number => (
  typeof value === 'number' && Number.isSafeInteger(value) && value !== 0 && Math.abs(value) <= 1_000_000
);
const isDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};
const isTimestamp = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length <= 40
  && /^\d{4}-\d{2}-\d{2}T/.test(value)
  && Number.isFinite(Date.parse(value))
);
const parseCurrency = (value: unknown): EconomyCurrency | null => (
  value === 'coins' || value === 'crystals' ? value : null
);

const parseCatalogItem = (value: unknown): AccountCatalogItem | null => {
  if (!isRecord(value) || !exactKeys(value, [
    'id', 'name', 'itemKind', 'tier', 'currency', 'price', 'assetKey', 'purchaseEnabled',
  ])) return null;
  if (typeof value.id !== 'string' || !ID.test(value.id)
    || typeof value.name !== 'string' || value.name.length < 1 || value.name.length > 80
    || (value.itemKind !== 'skin' && value.itemKind !== 'avatar_frame')
    || !['basic', 'premium', 'common', 'rare'].includes(String(value.tier))
    || !isSafeNonNegative(value.price) || value.price > 1_000_000
    || typeof value.assetKey !== 'string' || !ASSET_KEY.test(value.assetKey)
    || typeof value.purchaseEnabled !== 'boolean') return null;
  const currency = value.currency === null ? null : parseCurrency(value.currency);
  if (value.currency !== null && currency === null) return null;

  if (value.itemKind === 'skin') {
    if (!SKIN_CATALOG_BY_ID.has(value.id)
      || (value.tier !== 'basic' && value.tier !== 'premium')
      || currency === null) return null;
  } else {
    if (!KNOWN_FRAMES.has(value.id) || value.purchaseEnabled || currency !== null || value.price !== 0
      || (value.tier !== 'common' && value.tier !== 'rare')) return null;
  }
  return value as unknown as AccountCatalogItem;
};

const parseInventoryItem = (
  value: unknown,
  catalog: ReadonlyMap<string, AccountCatalogItem>,
): AccountInventoryItem | null => {
  if (!isRecord(value) || !exactKeys(value, [
    'id', 'name', 'itemKind', 'tier', 'assetKey', 'source', 'acquiredAt',
  ])) return null;
  const catalogItem = typeof value.id === 'string' ? catalog.get(value.id) : undefined;
  if (!catalogItem || value.name !== catalogItem.name || value.itemKind !== catalogItem.itemKind
    || value.tier !== catalogItem.tier || value.assetKey !== catalogItem.assetKey
    || (value.source !== 'purchase' && value.source !== 'check_in_milestone')
    || !isTimestamp(value.acquiredAt)) return null;
  return value as unknown as AccountInventoryItem;
};

const parseLedgerRow = (value: unknown): AccountLedgerRow | null => {
  if (!isRecord(value) || !exactKeys(value, [
    'id', 'currency', 'amount', 'balanceAfter', 'eventType', 'referenceId', 'createdAt',
  ])) return null;
  const currency = parseCurrency(value.currency);
  if (typeof value.id !== 'string' || !UUID.test(value.id) || currency === null
    || !isSafeDelta(value.amount) || !isSafeNonNegative(value.balanceAfter)
    || value.balanceAfter > 2_000_000_000
    || typeof value.eventType !== 'string' || !LEDGER_EVENTS.has(value.eventType)
    || typeof value.referenceId !== 'string' || value.referenceId.length < 1 || value.referenceId.length > 128
    || !isTimestamp(value.createdAt)) return null;
  return value as unknown as AccountLedgerRow;
};

const isDescendingLedger = (rows: readonly AccountLedgerRow[]): boolean => rows.every((row, index) => {
  if (index === 0) return true;
  const prior = rows[index - 1];
  const priorTime = Date.parse(prior.createdAt);
  const time = Date.parse(row.createdAt);
  return priorTime > time || (priorTime === time && prior.id.toLowerCase() > row.id.toLowerCase());
});

export const parseAccountEconomyEnvelope = (
  value: unknown,
  expectedLedgerLimit = DEFAULT_ACCOUNT_LEDGER_LIMIT,
): AccountEconomyState | null => {
  if (!Number.isSafeInteger(expectedLedgerLimit)
    || expectedLedgerLimit < 1 || expectedLedgerLimit > MAX_ACCOUNT_LEDGER_LIMIT
    || !isRecord(value) || !exactKeys(value, ['data']) || !isRecord(value.data)) return null;
  const data = value.data;
  if (!exactKeys(data, [
    'catalog', 'wallet', 'inventory', 'equippedSkinId', 'checkIn', 'onboarding', 'ledger', 'nextCursor',
  ]) || !Array.isArray(data.catalog) || data.catalog.length > 16
    || !Array.isArray(data.inventory) || data.inventory.length > 128 || !Array.isArray(data.ledger)
    || data.ledger.length > expectedLedgerLimit) return null;

  const catalogItems = data.catalog.map(parseCatalogItem);
  if (catalogItems.some(item => item === null)) return null;
  const catalog = catalogItems as AccountCatalogItem[];
  const catalogIds = new Set(catalog.map(item => item.id));
  if (catalogIds.size !== catalog.length) return null;
  const catalogById = new Map(catalog.map(item => [item.id, item]));

  if (!isRecord(data.wallet) || !exactKeys(data.wallet, ['coins', 'crystals'])
    || !isSafeNonNegative(data.wallet.coins) || data.wallet.coins > 2_000_000_000
    || !isSafeNonNegative(data.wallet.crystals) || data.wallet.crystals > 2_000_000_000) return null;

  const inventoryItems = data.inventory.map(item => parseInventoryItem(item, catalogById));
  if (inventoryItems.some(item => item === null)) return null;
  const inventory = inventoryItems as AccountInventoryItem[];
  const inventoryIds = new Set(inventory.map(item => item.id));
  if (inventoryIds.size !== inventory.length) return null;
  if (data.equippedSkinId !== null && (
    typeof data.equippedSkinId !== 'string'
    || !inventoryIds.has(data.equippedSkinId)
    || catalogById.get(data.equippedSkinId)?.itemKind !== 'skin'
  )) return null;

  if (!isRecord(data.checkIn) || !exactKeys(data.checkIn, [
    'streak', 'lastClaimDate', 'serverDate', 'claimedMilestoneDays',
  ]) || !isSafeNonNegative(data.checkIn.streak) || data.checkIn.streak > 1_000_000
    || (data.checkIn.lastClaimDate !== null && !isDate(data.checkIn.lastClaimDate))
    || !isDate(data.checkIn.serverDate) || !Array.isArray(data.checkIn.claimedMilestoneDays)) return null;
  const milestones = data.checkIn.claimedMilestoneDays;
  if (!milestones.every((day, index) => (
    ALLOWED_MILESTONES.includes(day as typeof ALLOWED_MILESTONES[number])
    && (index === 0 || Number(milestones[index - 1]) < Number(day))
  ))) return null;

  if (!isRecord(data.onboarding) || !exactKeys(data.onboarding, ['completed', 'completedAt'])
    || typeof data.onboarding.completed !== 'boolean'
    || (data.onboarding.completedAt !== null && !isTimestamp(data.onboarding.completedAt))
    || data.onboarding.completed !== (data.onboarding.completedAt !== null)) return null;

  const ledgerItems = data.ledger.map(parseLedgerRow);
  if (ledgerItems.some(item => item === null)) return null;
  const ledger = ledgerItems as AccountLedgerRow[];
  if (new Set(ledger.map(row => row.id)).size !== ledger.length || !isDescendingLedger(ledger)) return null;
  if (data.nextCursor !== null && (
    typeof data.nextCursor !== 'string' || !UUID.test(data.nextCursor)
    || ledger.length === 0 || data.nextCursor !== ledger[ledger.length - 1].id
  )) return null;

  return {
    catalog,
    wallet: { coins: data.wallet.coins, crystals: data.wallet.crystals },
    inventory,
    equippedSkinId: data.equippedSkinId as string | null,
    checkIn: {
      streak: data.checkIn.streak,
      lastClaimDate: data.checkIn.lastClaimDate as string | null,
      serverDate: data.checkIn.serverDate,
      claimedMilestoneDays: [...milestones] as number[],
    },
    onboarding: {
      completed: data.onboarding.completed,
      completedAt: data.onboarding.completedAt as string | null,
    },
    ledger,
    nextCursor: data.nextCursor as string | null,
  };
};

export const mergeAccountLedgerPage = (
  current: AccountEconomyState,
  page: AccountEconomyState,
  requestedCursor: string,
  seenCursors: ReadonlySet<string> = new Set(current.nextCursor ? [current.nextCursor] : []),
): AccountEconomyState | null => {
  if (current.nextCursor !== requestedCursor
    || (page.nextCursor !== null && seenCursors.has(page.nextCursor))) return null;
  const existingIds = new Set(current.ledger.map(row => row.id));
  const appended = page.ledger.filter(row => !existingIds.has(row.id));
  const ledger = [...current.ledger, ...appended];
  if (!isDescendingLedger(ledger)) return null;
  return { ...page, ledger, nextCursor: page.nextCursor };
};

const safeErrorCode = (value: unknown): string => {
  if (!isRecord(value) || !exactKeys(value, ['code']) || typeof value.code !== 'string') {
    return 'ECONOMY_REQUEST_FAILED';
  }
  return /^[A-Z][A-Z0-9_]{2,63}$/.test(value.code) ? value.code : 'ECONOMY_REQUEST_FAILED';
};

const readJson = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') || '';
  if (!/^application\/json(?:;|$)/i.test(contentType)) {
    throw new AccountEconomyRequestError(response.ok ? null : response.status, 'ECONOMY_RESPONSE_INVALID');
  }
  try {
    return JSON.parse(await response.text());
  } catch {
    throw new AccountEconomyRequestError(response.ok ? null : response.status, 'ECONOMY_RESPONSE_INVALID');
  }
};

export interface AccountEconomyTransportOptions {
  accessToken: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export const getAccountEconomyState = async (
  options: AccountEconomyTransportOptions,
  ledgerLimit = DEFAULT_ACCOUNT_LEDGER_LIMIT,
  ledgerCursor: string | null = null,
): Promise<AccountEconomyState> => {
  if (!Number.isSafeInteger(ledgerLimit) || ledgerLimit < 1 || ledgerLimit > MAX_ACCOUNT_LEDGER_LIMIT
    || (ledgerCursor !== null && !UUID.test(ledgerCursor))) {
    throw new AccountEconomyRequestError(null, 'ECONOMY_REQUEST_INVALID');
  }
  const query = new URLSearchParams({ ledgerLimit: String(ledgerLimit) });
  if (ledgerCursor) query.set('ledgerCursor', ledgerCursor);
  const response = await (options.fetchImpl ?? fetch)(`${ACCOUNT_ECONOMY_ENDPOINT}?${query}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${options.accessToken}` },
    signal: options.signal,
    credentials: 'same-origin',
  });
  const json = await readJson(response);
  if (!response.ok) throw new AccountEconomyRequestError(response.status, safeErrorCode(json));
  const parsed = parseAccountEconomyEnvelope(json, ledgerLimit);
  if (!parsed) throw new AccountEconomyRequestError(null, 'ECONOMY_RESPONSE_INVALID');
  return parsed;
};

export const postAccountEconomyMutation = async (
  options: AccountEconomyTransportOptions,
  action: AccountMutationAction,
  requestId: string,
  skinId?: string,
): Promise<void> => {
  if (!IDEMPOTENCY_KEY.test(requestId)
    || ((action === 'unlock_skin' || action === 'equip_skin') !== (typeof skinId === 'string'))
    || (skinId !== undefined && !SKIN_CATALOG_BY_ID.has(skinId))) {
    throw new AccountEconomyRequestError(null, 'ECONOMY_REQUEST_INVALID');
  }
  const body = skinId === undefined
    ? { action, idempotencyKey: requestId }
    : { action, idempotencyKey: requestId, skinId };
  const response = await (options.fetchImpl ?? fetch)(ACCOUNT_ECONOMY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: options.signal,
    credentials: 'same-origin',
  });
  const json = await readJson(response);
  if (!response.ok) throw new AccountEconomyRequestError(response.status, safeErrorCode(json));
  if (!isRecord(json) || !exactKeys(json, ['data']) || !isRecord(json.data)) {
    throw new AccountEconomyRequestError(null, 'ECONOMY_RESPONSE_INVALID');
  }
};

const hash = (value: string): string => {
  let current = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    current ^= value.charCodeAt(index);
    current = Math.imul(current, 16777619);
  }
  return (current >>> 0).toString(36);
};

export const accountScope = (userId: string): string => `account-${hash(userId)}`;
export const intentFingerprint = (action: AccountMutationAction, value = ''): string => (
  `${action}:${hash(`${action}:${value}`)}`
);

export const readAccountIntents = (storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): IntentReadResult => {
  if (!storage) return { status: 'missing', intents: [] };
  let raw: string | null;
  try { raw = storage.getItem(ACCOUNT_INTENT_STORAGE_KEY); } catch { return { status: 'corrupt', intents: [] }; }
  if (raw === null) return { status: 'missing', intents: [] };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !exactKeys(parsed, ['version', 'intents'])
      || parsed.version !== ACCOUNT_INTENT_VERSION || !Array.isArray(parsed.intents)) {
      return { status: 'corrupt', intents: [] };
    }
    const intents = parsed.intents;
    if (intents.length > 32 || !intents.every(intent => (
      isRecord(intent) && exactKeys(intent, ['version', 'scope', 'action', 'fingerprint', 'requestId'])
      && intent.version === ACCOUNT_INTENT_VERSION
      && typeof intent.scope === 'string' && /^account-[a-z0-9]+$/.test(intent.scope)
      && ['claim_check_in', 'finish_onboarding', 'unlock_skin', 'equip_skin'].includes(String(intent.action))
      && typeof intent.fingerprint === 'string' && /^[a-z_]+:[a-z0-9]+$/.test(intent.fingerprint)
      && typeof intent.requestId === 'string' && IDEMPOTENCY_KEY.test(intent.requestId)
    ))) return { status: 'corrupt', intents: [] };
    const unique = new Set(intents.map(intent => `${String(intent.scope)}:${String(intent.action)}:${String(intent.fingerprint)}`));
    if (unique.size !== intents.length) return { status: 'corrupt', intents: [] };
    return { status: 'valid', intents: intents as unknown as AccountIntent[] };
  } catch {
    return { status: 'corrupt', intents: [] };
  }
};

const writeAccountIntents = (storage: Storage, intents: readonly AccountIntent[]): boolean => {
  const envelope: AccountIntentEnvelope = { version: ACCOUNT_INTENT_VERSION, intents: [...intents] };
  try {
    storage.setItem(ACCOUNT_INTENT_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
};

const newRequestId = (): string => {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `economy:${uuid}`.slice(0, 128).padEnd(16, '0');
};

export const getOrCreateAccountIntent = (
  scope: string,
  action: AccountMutationAction,
  fingerprint: string,
  storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage,
  requestIdFactory: () => string = newRequestId,
): { status: 'ready'; intent: AccountIntent } | { status: 'unavailable' | 'corrupt' } => {
  if (!storage) return { status: 'unavailable' };
  const current = readAccountIntents(storage);
  if (current.status === 'corrupt') return { status: 'corrupt' };
  const existing = current.intents.find(intent => (
    intent.scope === scope && intent.action === action && intent.fingerprint === fingerprint
  ));
  if (existing) return { status: 'ready', intent: existing };
  const requestId = requestIdFactory();
  if (!IDEMPOTENCY_KEY.test(requestId)) return { status: 'corrupt' };
  const intent: AccountIntent = { version: ACCOUNT_INTENT_VERSION, scope, action, fingerprint, requestId };
  if (!writeAccountIntents(storage, [...current.intents, intent])) return { status: 'unavailable' };
  return { status: 'ready', intent };
};

export const clearAccountIntent = (
  target: AccountIntent,
  storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage,
): boolean => {
  if (!storage) return false;
  const current = readAccountIntents(storage);
  if (current.status === 'corrupt') return false;
  return writeAccountIntents(storage, current.intents.filter(intent => intent.requestId !== target.requestId));
};

export const reconcileConfirmedAccountIntents = (
  scope: string,
  state: AccountEconomyState,
  storage: Storage | null = typeof localStorage === 'undefined' ? null : localStorage,
): boolean => {
  if (!storage) return true;
  const current = readAccountIntents(storage);
  if (current.status === 'corrupt') return false;
  const confirmed = new Set<string>();
  if (state.checkIn.lastClaimDate === state.checkIn.serverDate) {
    confirmed.add(intentFingerprint('claim_check_in', state.checkIn.serverDate));
  }
  if (state.onboarding.completed) confirmed.add(intentFingerprint('finish_onboarding'));
  for (const item of state.inventory) {
    if (item.itemKind === 'skin') confirmed.add(intentFingerprint('unlock_skin', item.id));
  }
  if (state.equippedSkinId) confirmed.add(intentFingerprint('equip_skin', state.equippedSkinId));
  const remaining = current.intents.filter(intent => (
    intent.scope !== scope || !confirmed.has(intent.fingerprint)
  ));
  return remaining.length === current.intents.length || writeAccountIntents(storage, remaining);
};

export const stateConfirmsIntent = (
  state: AccountEconomyState,
  intent: AccountIntent,
  value = '',
): boolean => {
  switch (intent.action) {
    case 'claim_check_in': return state.checkIn.lastClaimDate === value && state.checkIn.serverDate === value;
    case 'finish_onboarding': return state.onboarding.completed;
    case 'unlock_skin': return state.inventory.some(item => item.id === value && item.itemKind === 'skin');
    case 'equip_skin': return state.equippedSkinId === value;
  }
};

export const accountErrorPhase = (error: unknown): AccountEconomyPhase => {
  if (error instanceof AccountEconomyRequestError) {
    if (error.status === 401) return 'reauthenticate';
    if (error.code === 'ECONOMY_RESPONSE_INVALID') return 'corrupt';
  }
  return 'unavailable';
};
