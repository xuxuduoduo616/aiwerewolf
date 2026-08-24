import {
  DAY_60_BASIC_SKIN_ID,
  SKIN_CATALOG_BY_ID,
  type EconomyCurrency,
} from './catalog';

export const GUEST_ECONOMY_SCHEMA = 'aiwerewolf.guest-economy-ledger';
export const GUEST_ECONOMY_VERSION = 1;
export const GUEST_ECONOMY_NAMESPACE = 'guest';
export const GUEST_ECONOMY_STORAGE_KEY = 'aiwerewolf:economy:guest:v1:ledger';
export const MAX_ECONOMY_BALANCE = 1_000_000_000;
export const MAX_LEDGER_EVENTS = 20_000;

export const CHECK_IN_REWARDS = [30, 40, 50, 60, 70, 100, 250] as const;

export interface CheckInMilestone {
  day: 7 | 14 | 30 | 60 | 90;
  coins: number;
  crystals: number;
  assets: readonly string[];
  label: string;
}

export const CHECK_IN_MILESTONES: readonly CheckInMilestone[] = [
  { day: 7, coins: 0, crystals: 0, assets: ['avatar-frame:ink-ring'], label: 'Common Ink Ring avatar frame' },
  { day: 14, coins: 300, crystals: 0, assets: [], label: '300 Coins' },
  { day: 30, coins: 0, crystals: 3, assets: [], label: '3 Crystals' },
  { day: 60, coins: 0, crystals: 0, assets: [`skin:${DAY_60_BASIC_SKIN_ID}`], label: 'Mist Wanderer Basic skin' },
  { day: 90, coins: 0, crystals: 8, assets: ['avatar-frame:crimson-moon'], label: '8 Crystals and rare Crimson Moon avatar frame' },
] as const;

export type GuestEconomyEventType =
  | 'CHECK_IN'
  | 'TUTORIAL_SKIPPED'
  | 'TUTORIAL_FINISHED'
  | 'GAME_REWARD'
  | 'SKIN_UNLOCKED'
  | 'SKIN_EQUIPPED';

interface GuestEconomyEventBase {
  id: string;
  idempotencyKey: string;
  type: GuestEconomyEventType;
  occurredAt: string;
  localDay: string;
  delta: {
    coins: number;
    crystals: number;
  };
}

export interface CheckInEvent extends GuestEconomyEventBase {
  type: 'CHECK_IN';
  streak: number;
  milestoneDays: number[];
}

export interface TutorialSkippedEvent extends GuestEconomyEventBase {
  type: 'TUTORIAL_SKIPPED';
}

export interface TutorialFinishedEvent extends GuestEconomyEventBase {
  type: 'TUTORIAL_FINISHED';
}

export interface GameRewardEvent extends GuestEconomyEventBase {
  type: 'GAME_REWARD';
  gameId: string;
  won: boolean;
}

export interface SkinUnlockedEvent extends GuestEconomyEventBase {
  type: 'SKIN_UNLOCKED';
  skinId: string;
  currency: EconomyCurrency;
  price: number;
}

export interface SkinEquippedEvent extends GuestEconomyEventBase {
  type: 'SKIN_EQUIPPED';
  skinId: string;
}

export type GuestEconomyEvent =
  | CheckInEvent
  | TutorialSkippedEvent
  | TutorialFinishedEvent
  | GameRewardEvent
  | SkinUnlockedEvent
  | SkinEquippedEvent;

export interface GuestEconomyLedgerV1 {
  schema: typeof GUEST_ECONOMY_SCHEMA;
  version: typeof GUEST_ECONOMY_VERSION;
  namespace: typeof GUEST_ECONOMY_NAMESPACE;
  events: GuestEconomyEvent[];
}

export interface GuestEconomyState {
  coins: number;
  crystals: number;
  inventory: string[];
  equippedSkinId: string | null;
  checkInStreak: number;
  lastCheckInDay: string | null;
  claimedMilestoneDays: number[];
  tutorialSeen: boolean;
  tutorialFinished: boolean;
  rewardedGameIds: string[];
  events: GuestEconomyEvent[];
}

export type LedgerReadResult =
  | { status: 'valid'; ledger: GuestEconomyLedgerV1; state: GuestEconomyState }
  | { status: 'missing'; ledger: GuestEconomyLedgerV1; state: GuestEconomyState }
  | { status: 'corrupt'; ledger: null; state: GuestEconomyState };

export type EconomyMutationCode =
  | 'applied'
  | 'already-applied'
  | 'insufficient-balance'
  | 'not-owned'
  | 'already-owned'
  | 'storage-unavailable'
  | 'account-unavailable'
  | 'ledger-corrupt'
  | 'invalid-request'
  | 'write-failed';

export interface EconomyMutationResult {
  ok: boolean;
  code: EconomyMutationCode;
  state: GuestEconomyState;
  event?: GuestEconomyEvent;
}

const EMPTY_STATE = (): GuestEconomyState => ({
  coins: 0,
  crystals: 0,
  inventory: [],
  equippedSkinId: null,
  checkInStreak: 0,
  lastCheckInDay: null,
  claimedMilestoneDays: [],
  tutorialSeen: false,
  tutorialFinished: false,
  rewardedGameIds: [],
  events: [],
});

export const createEmptyGuestEconomyLedger = (): GuestEconomyLedgerV1 => ({
  schema: GUEST_ECONOMY_SCHEMA,
  version: GUEST_ECONOMY_VERSION,
  namespace: GUEST_ECONOMY_NAMESPACE,
  events: [],
});

export const createEmptyGuestEconomyState = (): GuestEconomyState => EMPTY_STATE();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSafeAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_ECONOMY_BALANCE;

const isValidId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[a-zA-Z0-9:._-]+$/.test(value);

const isValidLocalDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
};

const isValidOccurredAt = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));

const addSafeBalance = (current: number, delta: number): number | null => {
  const next = current + delta;
  if (!Number.isSafeInteger(next) || next < 0 || next > MAX_ECONOMY_BALANCE) return null;
  return next;
};

const sortNumbers = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);

const sameNumbers = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

export const localDayFromDate = (date: Date): string => {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const previousLocalDay = (day: string): string | null => {
  if (!isValidLocalDay(day)) return null;
  const [year, month, date] = day.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, date - 1));
  return `${String(previous.getUTCFullYear()).padStart(4, '0')}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-${String(previous.getUTCDate()).padStart(2, '0')}`;
};

export const getNextCheckInStreak = (
  lastCheckInDay: string | null,
  currentStreak: number,
  nextLocalDay: string,
): number => lastCheckInDay === previousLocalDay(nextLocalDay) ? currentStreak + 1 : 1;

const expectedMilestonesForStreak = (
  streak: number,
  alreadyClaimed: readonly number[],
): CheckInMilestone[] => CHECK_IN_MILESTONES.filter(
  milestone => milestone.day === streak && !alreadyClaimed.includes(milestone.day),
);

const commonEventIsValid = (event: Record<string, unknown>): boolean => {
  if (!isValidId(event.id) || !isValidId(event.idempotencyKey)) return false;
  if (event.id !== event.idempotencyKey) return false;
  if (!isValidOccurredAt(event.occurredAt) || !isValidLocalDay(event.localDay)) return false;
  if (!isRecord(event.delta)) return false;
  return isSafeAmount(event.delta.coins) && isSafeAmount(event.delta.crystals);
};

const cloneEvent = (event: GuestEconomyEvent): GuestEconomyEvent =>
  JSON.parse(JSON.stringify(event)) as GuestEconomyEvent;

/**
 * Replays every event and checks it against the version-one business rules.
 * No stored balance or inventory snapshot is trusted.
 */
export const reduceGuestEconomyLedger = (events: readonly unknown[]): GuestEconomyState | null => {
  if (events.length > MAX_LEDGER_EVENTS) return null;

  const state = EMPTY_STATE();
  const eventIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  let lastOccurredAt = -Infinity;
  let equipEventCount = 0;

  for (const candidate of events) {
    if (!isRecord(candidate) || !commonEventIsValid(candidate)) return null;
    if (typeof candidate.type !== 'string') return null;
    if (eventIds.has(candidate.id as string) || idempotencyKeys.has(candidate.idempotencyKey as string)) return null;
    const occurredAt = Date.parse(candidate.occurredAt as string);
    if (occurredAt < lastOccurredAt) return null;
    lastOccurredAt = occurredAt;

    const delta = candidate.delta as { coins: number; crystals: number };
    let nextCoins = state.coins;
    let nextCrystals = state.crystals;

    switch (candidate.type) {
      case 'CHECK_IN': {
        if (!Number.isSafeInteger(candidate.streak) || (candidate.streak as number) < 1) return null;
        if (!Array.isArray(candidate.milestoneDays) || !candidate.milestoneDays.every(day => Number.isSafeInteger(day))) return null;
        if (candidate.idempotencyKey !== `check-in:${candidate.localDay}`) return null;
        if (state.lastCheckInDay === candidate.localDay) return null;

        const expectedStreak = state.lastCheckInDay === previousLocalDay(candidate.localDay as string)
          ? state.checkInStreak + 1
          : 1;
        if (candidate.streak !== expectedStreak) return null;

        const milestones = expectedMilestonesForStreak(expectedStreak, state.claimedMilestoneDays);
        const expectedMilestoneDays = milestones.map(milestone => milestone.day);
        if (!sameNumbers(sortNumbers(candidate.milestoneDays as number[]), expectedMilestoneDays)) return null;

        const expectedCoins = CHECK_IN_REWARDS[(expectedStreak - 1) % CHECK_IN_REWARDS.length]
          + milestones.reduce((sum, milestone) => sum + milestone.coins, 0);
        const expectedCrystals = milestones.reduce((sum, milestone) => sum + milestone.crystals, 0);
        if (delta.coins !== expectedCoins || delta.crystals !== expectedCrystals) return null;

        nextCoins = addSafeBalance(state.coins, delta.coins) ?? -1;
        nextCrystals = addSafeBalance(state.crystals, delta.crystals) ?? -1;
        state.checkInStreak = expectedStreak;
        state.lastCheckInDay = candidate.localDay as string;
        state.claimedMilestoneDays = sortNumbers([
          ...state.claimedMilestoneDays,
          ...expectedMilestoneDays,
        ]);
        for (const asset of milestones.flatMap(milestone => [...milestone.assets])) {
          if (!state.inventory.includes(asset)) state.inventory.push(asset);
        }
        break;
      }
      case 'TUTORIAL_SKIPPED': {
        if (candidate.idempotencyKey !== 'tutorial:skip:v1') return null;
        if (delta.coins !== 0 || delta.crystals !== 0 || state.tutorialSeen) return null;
        state.tutorialSeen = true;
        break;
      }
      case 'TUTORIAL_FINISHED': {
        if (candidate.idempotencyKey !== 'tutorial:finish:v1') return null;
        if (delta.coins !== 200 || delta.crystals !== 0 || state.tutorialFinished) return null;
        nextCoins = addSafeBalance(state.coins, delta.coins) ?? -1;
        state.tutorialSeen = true;
        state.tutorialFinished = true;
        break;
      }
      case 'GAME_REWARD': {
        if (!isValidId(candidate.gameId) || typeof candidate.won !== 'boolean') return null;
        if (candidate.idempotencyKey !== `game:${candidate.gameId}`) return null;
        if (state.rewardedGameIds.includes(candidate.gameId)) return null;

        const todayEvents = state.events.filter(event => event.type === 'GAME_REWARD' && event.localDay === candidate.localDay);
        const todayCoins = todayEvents.reduce((sum, event) => sum + event.delta.coins, 0);
        const nominal = 40 + (candidate.won ? 20 : 0) + (todayEvents.length === 0 ? 40 : 0);
        const expectedCoins = todayEvents.length >= 5
          ? 0
          : Math.max(0, Math.min(nominal, 200 - todayCoins));
        if (delta.coins !== expectedCoins || delta.crystals !== 0) return null;

        nextCoins = addSafeBalance(state.coins, delta.coins) ?? -1;
        state.rewardedGameIds.push(candidate.gameId);
        break;
      }
      case 'SKIN_UNLOCKED': {
        if (!isValidId(candidate.skinId) || (candidate.currency !== 'coins' && candidate.currency !== 'crystals')) return null;
        const product = SKIN_CATALOG_BY_ID.get(candidate.skinId);
        if (!product || product.currency !== candidate.currency || product.price !== candidate.price) return null;
        if (candidate.idempotencyKey !== `skin-unlock:${candidate.skinId}`) return null;
        const assetId = `skin:${candidate.skinId}`;
        if (state.inventory.includes(assetId)) return null;
        if (candidate.currency === 'coins') {
          if (delta.coins !== -product.price || delta.crystals !== 0) return null;
        } else if (delta.coins !== 0 || delta.crystals !== -product.price) {
          return null;
        }
        nextCoins = addSafeBalance(state.coins, delta.coins) ?? -1;
        nextCrystals = addSafeBalance(state.crystals, delta.crystals) ?? -1;
        state.inventory.push(assetId);
        break;
      }
      case 'SKIN_EQUIPPED': {
        if (!isValidId(candidate.skinId) || !SKIN_CATALOG_BY_ID.has(candidate.skinId)) return null;
        if (!state.inventory.includes(`skin:${candidate.skinId}`)) return null;
        const expectedKey = `skin-equip:${candidate.skinId}:v${equipEventCount + 1}`;
        if (candidate.idempotencyKey !== expectedKey) return null;
        if (delta.coins !== 0 || delta.crystals !== 0 || state.equippedSkinId === candidate.skinId) return null;
        state.equippedSkinId = candidate.skinId as string;
        equipEventCount += 1;
        break;
      }
      default:
        return null;
    }

    if (nextCoins < 0 || nextCrystals < 0) return null;
    state.coins = nextCoins;
    state.crystals = nextCrystals;
    eventIds.add(candidate.id as string);
    idempotencyKeys.add(candidate.idempotencyKey as string);
    state.events.push(cloneEvent(candidate as unknown as GuestEconomyEvent));
  }

  return state;
};

export const parseGuestEconomyLedger = (raw: string): { ledger: GuestEconomyLedgerV1; state: GuestEconomyState } | null => {
  try {
    const candidate: unknown = JSON.parse(raw);
    if (!isRecord(candidate)) return null;
    if (candidate.schema !== GUEST_ECONOMY_SCHEMA) return null;
    if (candidate.version !== GUEST_ECONOMY_VERSION) return null;
    if (candidate.namespace !== GUEST_ECONOMY_NAMESPACE) return null;
    if (!Array.isArray(candidate.events)) return null;
    const state = reduceGuestEconomyLedger(candidate.events);
    if (!state) return null;
    return {
      ledger: {
        schema: GUEST_ECONOMY_SCHEMA,
        version: GUEST_ECONOMY_VERSION,
        namespace: GUEST_ECONOMY_NAMESPACE,
        events: state.events.map(cloneEvent),
      },
      state,
    };
  } catch {
    return null;
  }
};

const getBrowserStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const readGuestEconomyLedger = (storage?: Storage | null): LedgerReadResult => {
  const activeStorage = storage === undefined ? getBrowserStorage() : storage;
  if (!activeStorage) return { status: 'missing', ledger: createEmptyGuestEconomyLedger(), state: EMPTY_STATE() };
  try {
    const raw = activeStorage.getItem(GUEST_ECONOMY_STORAGE_KEY);
    if (raw === null) return { status: 'missing', ledger: createEmptyGuestEconomyLedger(), state: EMPTY_STATE() };
    const parsed = parseGuestEconomyLedger(raw);
    return parsed
      ? { status: 'valid', ledger: parsed.ledger, state: parsed.state }
      : { status: 'corrupt', ledger: null, state: EMPTY_STATE() };
  } catch {
    return { status: 'corrupt', ledger: null, state: EMPTY_STATE() };
  }
};

const mutationFailure = (code: EconomyMutationCode, state = EMPTY_STATE()): EconomyMutationResult => ({
  ok: false,
  code,
  state,
});

const appendEvent = (
  event: GuestEconomyEvent,
  storage?: Storage | null,
): EconomyMutationResult => {
  const activeStorage = storage === undefined ? getBrowserStorage() : storage;
  if (!activeStorage) return mutationFailure('storage-unavailable');

  const current = readGuestEconomyLedger(activeStorage);
  if (current.status === 'corrupt') return mutationFailure('ledger-corrupt');
  const existing = current.ledger.events.find(entry => entry.idempotencyKey === event.idempotencyKey);
  if (existing) return { ok: true, code: 'already-applied', state: current.state, event: existing };
  if (current.ledger.events.length >= MAX_LEDGER_EVENTS) return mutationFailure('ledger-corrupt');

  const nextLedger: GuestEconomyLedgerV1 = {
    ...current.ledger,
    events: [...current.ledger.events, event],
  };
  const nextState = reduceGuestEconomyLedger(nextLedger.events);
  if (!nextState) return mutationFailure('invalid-request', current.state);

  try {
    activeStorage.setItem(GUEST_ECONOMY_STORAGE_KEY, JSON.stringify(nextLedger));
    const verified = readGuestEconomyLedger(activeStorage);
    if (verified.status === 'corrupt' || !verified.ledger.events.some(entry => entry.idempotencyKey === event.idempotencyKey)) {
      return mutationFailure('write-failed', current.state);
    }
    return { ok: true, code: 'applied', state: verified.state, event };
  } catch {
    return mutationFailure('write-failed', current.state);
  }
};

const makeBaseEvent = (
  type: GuestEconomyEventType,
  idempotencyKey: string,
  delta: { coins: number; crystals: number },
  now: Date,
): GuestEconomyEventBase => ({
  id: idempotencyKey,
  idempotencyKey,
  type,
  occurredAt: now.toISOString(),
  localDay: localDayFromDate(now),
  delta,
});

export const claimGuestDailyCheckIn = (
  storage?: Storage | null,
  now = new Date(),
): EconomyMutationResult => {
  const current = readGuestEconomyLedger(storage);
  if (current.status === 'corrupt') return mutationFailure('ledger-corrupt');
  const localDay = localDayFromDate(now);
  const key = `check-in:${localDay}`;
  const existing = current.ledger.events.find(event => event.idempotencyKey === key);
  if (existing) return { ok: true, code: 'already-applied', state: current.state, event: existing };

  const streak = getNextCheckInStreak(current.state.lastCheckInDay, current.state.checkInStreak, localDay);
  const milestones = expectedMilestonesForStreak(streak, current.state.claimedMilestoneDays);
  const event: CheckInEvent = {
    ...makeBaseEvent('CHECK_IN', key, {
      coins: CHECK_IN_REWARDS[(streak - 1) % CHECK_IN_REWARDS.length]
        + milestones.reduce((sum, milestone) => sum + milestone.coins, 0),
      crystals: milestones.reduce((sum, milestone) => sum + milestone.crystals, 0),
    }, now),
    type: 'CHECK_IN',
    streak,
    milestoneDays: milestones.map(milestone => milestone.day),
  };
  return appendEvent(event, storage);
};

export const recordGuestTutorialSkip = (
  storage?: Storage | null,
  now = new Date(),
): EconomyMutationResult => appendEvent({
  ...makeBaseEvent('TUTORIAL_SKIPPED', 'tutorial:skip:v1', { coins: 0, crystals: 0 }, now),
  type: 'TUTORIAL_SKIPPED',
}, storage);

export const finishGuestTutorial = (
  storage?: Storage | null,
  now = new Date(),
): EconomyMutationResult => appendEvent({
  ...makeBaseEvent('TUTORIAL_FINISHED', 'tutorial:finish:v1', { coins: 200, crystals: 0 }, now),
  type: 'TUTORIAL_FINISHED',
}, storage);

export const rewardGuestGame = (
  gameId: string,
  won: boolean,
  storage?: Storage | null,
  now = new Date(),
): EconomyMutationResult => {
  if (!isValidId(gameId)) return mutationFailure('invalid-request');
  const current = readGuestEconomyLedger(storage);
  if (current.status === 'corrupt') return mutationFailure('ledger-corrupt');
  const key = `game:${gameId}`;
  const existing = current.ledger.events.find(event => event.idempotencyKey === key);
  if (existing) return { ok: true, code: 'already-applied', state: current.state, event: existing };

  const localDay = localDayFromDate(now);
  const todayEvents = current.state.events.filter(event => event.type === 'GAME_REWARD' && event.localDay === localDay);
  const todayCoins = todayEvents.reduce((sum, event) => sum + event.delta.coins, 0);
  const nominal = 40 + (won ? 20 : 0) + (todayEvents.length === 0 ? 40 : 0);
  const coins = todayEvents.length >= 5 ? 0 : Math.max(0, Math.min(nominal, 200 - todayCoins));
  const event: GameRewardEvent = {
    ...makeBaseEvent('GAME_REWARD', key, { coins, crystals: 0 }, now),
    type: 'GAME_REWARD',
    gameId,
    won,
  };
  return appendEvent(event, storage);
};

export const unlockGuestSkin = (
  skinId: string,
  storage?: Storage | null,
  now = new Date(),
): EconomyMutationResult => {
  const product = SKIN_CATALOG_BY_ID.get(skinId);
  if (!product) return mutationFailure('invalid-request');
  const current = readGuestEconomyLedger(storage);
  if (current.status === 'corrupt') return mutationFailure('ledger-corrupt');
  if (current.state.inventory.includes(`skin:${skinId}`)) {
    return mutationFailure('already-owned', current.state);
  }
  const balance = product.currency === 'coins' ? current.state.coins : current.state.crystals;
  if (balance < product.price) return mutationFailure('insufficient-balance', current.state);

  const event: SkinUnlockedEvent = {
    ...makeBaseEvent('SKIN_UNLOCKED', `skin-unlock:${skinId}`, {
      coins: product.currency === 'coins' ? -product.price : 0,
      crystals: product.currency === 'crystals' ? -product.price : 0,
    }, now),
    type: 'SKIN_UNLOCKED',
    skinId,
    currency: product.currency,
    price: product.price,
  };
  return appendEvent(event, storage);
};

export const equipGuestSkin = (
  skinId: string,
  storage?: Storage | null,
  now = new Date(),
): EconomyMutationResult => {
  if (!SKIN_CATALOG_BY_ID.has(skinId)) return mutationFailure('invalid-request');
  const current = readGuestEconomyLedger(storage);
  if (current.status === 'corrupt') return mutationFailure('ledger-corrupt');
  if (!current.state.inventory.includes(`skin:${skinId}`)) return mutationFailure('not-owned', current.state);
  if (current.state.equippedSkinId === skinId) {
    return { ok: true, code: 'already-applied', state: current.state };
  }
  const equipEventCount = current.state.events.filter(event => event.type === 'SKIN_EQUIPPED').length;
  const key = `skin-equip:${skinId}:v${equipEventCount + 1}`;
  const event: SkinEquippedEvent = {
    ...makeBaseEvent('SKIN_EQUIPPED', key, { coins: 0, crystals: 0 }, now),
    type: 'SKIN_EQUIPPED',
    skinId,
  };
  return appendEvent(event, storage);
};

export const describeEconomyEvent = (event: GuestEconomyEvent): string => {
  switch (event.type) {
    case 'CHECK_IN':
      return event.milestoneDays.length > 0
        ? `Daily check-in · streak day ${event.streak} · milestone ${event.milestoneDays.join(', ')}`
        : `Daily check-in · streak day ${event.streak}`;
    case 'TUTORIAL_SKIPPED':
      return 'New-player guide skipped';
    case 'TUTORIAL_FINISHED':
      return 'New-player guide finished';
    case 'GAME_REWARD':
      return event.delta.coins > 0
        ? `Completed local match · ${event.won ? 'victory' : 'match complete'}`
        : 'Completed local match · daily reward cap reached';
    case 'SKIN_UNLOCKED':
      return `Skin unlocked · ${SKIN_CATALOG_BY_ID.get(event.skinId)?.name ?? event.skinId}`;
    case 'SKIN_EQUIPPED':
      return `Skin equipped · ${SKIN_CATALOG_BY_ID.get(event.skinId)?.name ?? event.skinId}`;
  }
};
