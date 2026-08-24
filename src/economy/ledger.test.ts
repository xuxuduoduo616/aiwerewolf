import { describe, expect, it, vi } from 'vitest';
import {
  CHECK_IN_MILESTONES,
  CHECK_IN_REWARDS,
  GUEST_ECONOMY_NAMESPACE,
  GUEST_ECONOMY_SCHEMA,
  GUEST_ECONOMY_STORAGE_KEY,
  GUEST_ECONOMY_VERSION,
  claimGuestDailyCheckIn,
  equipGuestSkin,
  finishGuestTutorial,
  parseGuestEconomyLedger,
  readGuestEconomyLedger,
  recordGuestTutorialSkip,
  rewardGuestGame,
  unlockGuestSkin,
} from './ledger';
import { BASIC_SKIN_PRICES, PREMIUM_SKIN_PRICES, SKIN_CATALOG } from './catalog';
import { runEconomyMutationForIdentity } from '../hooks/useGuestEconomy';

const createMemoryStorage = () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => [...values.keys()][index] ?? null,
    removeItem: key => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
  return { storage, values };
};

const localNoon = (offset: number): Date => new Date(2026, 0, 1 + offset, 12, 0, 0, 0);

describe('guest economy ledger schema and check-in', () => {
  it('uses one stable guest namespace and derives zero balances from an empty ledger', () => {
    const { storage } = createMemoryStorage();
    const result = readGuestEconomyLedger(storage);
    expect(result.status).toBe('missing');
    expect(result.ledger).toEqual({
      schema: GUEST_ECONOMY_SCHEMA,
      version: GUEST_ECONOMY_VERSION,
      namespace: GUEST_ECONOMY_NAMESPACE,
      events: [],
    });
    expect(result.state.coins).toBe(0);
    expect(result.state.crystals).toBe(0);
  });

  it('applies the 7-day cycle and all 7/14/30/60/90 milestones exactly once', () => {
    const { storage } = createMemoryStorage();
    for (let offset = 0; offset < 90; offset += 1) {
      expect(claimGuestDailyCheckIn(storage, localNoon(offset)).ok).toBe(true);
    }
    const result = readGuestEconomyLedger(storage);
    const baseCoins = Array.from({ length: 90 }, (_, index) => CHECK_IN_REWARDS[index % 7])
      .reduce((sum, reward) => sum + reward, 0);
    expect(result.state.checkInStreak).toBe(90);
    expect(result.state.claimedMilestoneDays).toEqual(CHECK_IN_MILESTONES.map(item => item.day));
    expect(result.state.coins).toBe(baseCoins + 300);
    expect(result.state.crystals).toBe(11);
    expect(result.state.inventory).toEqual(expect.arrayContaining([
      'avatar-frame:ink-ring',
      'skin:mist-wanderer',
      'avatar-frame:crimson-moon',
    ]));
    expect(result.state.events.filter(event => event.type === 'CHECK_IN')).toHaveLength(90);
  });

  it('returns the same result for same-day retries without rewriting or double crediting', () => {
    const { storage, values } = createMemoryStorage();
    const first = claimGuestDailyCheckIn(storage, localNoon(0));
    const rawAfterFirst = values.get(GUEST_ECONOMY_STORAGE_KEY);
    const replay = claimGuestDailyCheckIn(storage, new Date(2026, 0, 1, 21, 15));
    expect(first.code).toBe('applied');
    expect(replay.code).toBe('already-applied');
    expect(replay.state.coins).toBe(30);
    expect(replay.state.events).toHaveLength(1);
    expect(values.get(GUEST_ECONOMY_STORAGE_KEY)).toBe(rawAfterFirst);
  });

  it('resets a missed streak to one while retaining already-claimed milestones', () => {
    const { storage } = createMemoryStorage();
    for (let offset = 0; offset < 7; offset += 1) claimGuestDailyCheckIn(storage, localNoon(offset));
    const afterGap = claimGuestDailyCheckIn(storage, localNoon(9));
    expect(afterGap.state.checkInStreak).toBe(1);
    expect(afterGap.state.claimedMilestoneDays).toEqual([7]);
    expect(afterGap.event?.type === 'CHECK_IN' ? afterGap.event.milestoneDays : []).toEqual([]);
  });
});

describe('tutorial, gameplay, and cosmetic idempotency', () => {
  it('supports Skip and later Finish but grants the 200 Coins finish reward only once', () => {
    const { storage } = createMemoryStorage();
    expect(recordGuestTutorialSkip(storage, localNoon(0)).code).toBe('applied');
    const finish = finishGuestTutorial(storage, localNoon(0));
    const replay = finishGuestTutorial(storage, localNoon(1));
    expect(finish.state.coins).toBe(200);
    expect(finish.state.tutorialFinished).toBe(true);
    expect(replay.code).toBe('already-applied');
    expect(replay.state.coins).toBe(200);
    expect(replay.state.events).toHaveLength(2);
  });

  it('rewards terminal game ids once and enforces both daily game and 200-Coin caps', () => {
    const { storage } = createMemoryStorage();
    const rewards = Array.from({ length: 6 }, (_, index) =>
      rewardGuestGame(`local-game-${index + 1}`, true, storage, localNoon(0)));
    expect(rewards.map(result => result.event?.delta.coins)).toEqual([100, 60, 40, 0, 0, 0]);
    expect(rewards.filter(result => (result.event?.delta.coins ?? 0) > 0)).toHaveLength(3);
    expect(readGuestEconomyLedger(storage).state.coins).toBe(200);

    const beforeReplay = storage.getItem(GUEST_ECONOMY_STORAGE_KEY);
    const replay = rewardGuestGame('local-game-1', true, storage, localNoon(1));
    expect(replay.code).toBe('already-applied');
    expect(storage.getItem(GUEST_ECONOMY_STORAGE_KEY)).toBe(beforeReplay);
  });

  it('makes unlock deduction plus inventory append atomic and equip presentation-only', () => {
    const { storage } = createMemoryStorage();
    for (let offset = 0; offset < 7; offset += 1) claimGuestDailyCheckIn(storage, localNoon(offset));
    finishGuestTutorial(storage, localNoon(7));
    expect(readGuestEconomyLedger(storage).state.coins).toBe(800);

    const eventCount = readGuestEconomyLedger(storage).state.events.length;
    const insufficient = unlockGuestSkin('bamboo-vigil', storage, localNoon(8));
    expect(insufficient.code).toBe('insufficient-balance');
    expect(insufficient.state.events).toHaveLength(eventCount);
    expect(insufficient.state.inventory).not.toContain('skin:bamboo-vigil');

    const unlocked = unlockGuestSkin('mist-wanderer', storage, localNoon(8));
    expect(unlocked.ok).toBe(true);
    expect(unlocked.state.coins).toBe(0);
    expect(unlocked.state.inventory).toContain('skin:mist-wanderer');
    expect(unlocked.state.events.at(-1)?.delta).toEqual({ coins: -800, crystals: 0 });

    const equipped = equipGuestSkin('mist-wanderer', storage, localNoon(8));
    expect(equipped.state.equippedSkinId).toBe('mist-wanderer');
    expect(equipped.state.coins).toBe(0);
    expect(equipped.state.crystals).toBe(0);
    expect(equipped.state.events.at(-1)?.delta).toEqual({ coins: 0, crystals: 0 });
    expect(equipGuestSkin('mist-wanderer', storage, localNoon(9)).code).toBe('already-applied');
  });

  it('publishes only the required Basic and Premium price tiers', () => {
    expect([...new Set(SKIN_CATALOG.filter(item => item.tier === 'Basic').map(item => item.price))].sort((a, b) => a - b)).toEqual([...BASIC_SKIN_PRICES]);
    expect([...new Set(SKIN_CATALOG.filter(item => item.tier === 'Premium').map(item => item.price))].sort((a, b) => a - b)).toEqual([...PREMIUM_SKIN_PRICES]);
    expect(new Set(SKIN_CATALOG.map(item => item.currency))).toEqual(new Set(['coins', 'crystals']));
  });
});

describe('fail-closed recovery and account boundary', () => {
  it.each([
    ['invalid JSON', '{bad-json'],
    ['unknown version', JSON.stringify({ schema: GUEST_ECONOMY_SCHEMA, version: 999, namespace: GUEST_ECONOMY_NAMESPACE, events: [] })],
    ['incomplete event', JSON.stringify({ schema: GUEST_ECONOMY_SCHEMA, version: 1, namespace: GUEST_ECONOMY_NAMESPACE, events: [{ type: 'CHECK_IN' }] })],
  ])('treats %s as corrupt and does not overwrite it', (_label, raw) => {
    const { storage } = createMemoryStorage();
    storage.setItem(GUEST_ECONOMY_STORAGE_KEY, raw);
    expect(readGuestEconomyLedger(storage).status).toBe('corrupt');
    const mutation = claimGuestDailyCheckIn(storage, localNoon(0));
    expect(mutation.code).toBe('ledger-corrupt');
    expect(mutation.state.coins).toBe(0);
    expect(storage.getItem(GUEST_ECONOMY_STORAGE_KEY)).toBe(raw);
  });

  it('rejects negative, overflow-like, and forged event deltas during replay', () => {
    const { storage } = createMemoryStorage();
    finishGuestTutorial(storage, localNoon(0));
    const valid = JSON.parse(storage.getItem(GUEST_ECONOMY_STORAGE_KEY) ?? '{}') as { events: Array<{ delta: { coins: number } }> };
    for (const forged of [-200, Number.MAX_SAFE_INTEGER]) {
      const candidate = structuredClone(valid);
      candidate.events[0].delta.coins = forged;
      expect(parseGuestEconomyLedger(JSON.stringify(candidate))).toBeNull();
    }
  });

  it('never invokes guest storage work for an authenticated account mutation', () => {
    const operation = vi.fn(() => finishGuestTutorial(null, localNoon(0)));
    const result = runEconomyMutationForIdentity(false, operation);
    expect(result.code).toBe('account-unavailable');
    expect(result.state.coins).toBe(0);
    expect(result.state.inventory).toEqual([]);
    expect(operation).not.toHaveBeenCalled();
  });
});
