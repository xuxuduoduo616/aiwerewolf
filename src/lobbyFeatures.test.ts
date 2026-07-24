import { describe, expect, it } from 'vitest';
import {
  LOBBY_FEATURES_STORAGE_PREFIX,
  LOBBY_SUBVIEWS,
  MAX_LOCAL_FACTION_CONTRIBUTION,
  claimLobbyActivity,
  claimLobbyBattlePassTier,
  claimLobbyBattlePassTiers,
  contributeToLobbyFaction,
  createDefaultLobbyFeatureState,
  getLobbyFeatureStorageKey,
  loadLobbyFeatureState,
  parseLobbyFeatureState,
  saveLobbyFeatureState,
} from './lobbyFeatures';

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

describe('lobby feature contracts', () => {
  it('exports the exact LobbySubview set in contract order', () => {
    expect(LOBBY_SUBVIEWS).toEqual([
      'home',
      'mode-choice',
      'match-setup',
      'activity',
      'faction-support',
      'battle-pass',
    ]);
  });

  it('builds exact user and guest storage keys without collapsing long ids', () => {
    const longId = `user-${'x'.repeat(500)}`;
    expect(getLobbyFeatureStorageKey('user-1')).toBe(`${LOBBY_FEATURES_STORAGE_PREFIX}user-1`);
    expect(getLobbyFeatureStorageKey()).toBe(`${LOBBY_FEATURES_STORAGE_PREFIX}guest`);
    expect(getLobbyFeatureStorageKey('')).toBe(`${LOBBY_FEATURES_STORAGE_PREFIX}guest`);
    expect(getLobbyFeatureStorageKey('   ')).toBe(`${LOBBY_FEATURES_STORAGE_PREFIX}guest`);
    expect(getLobbyFeatureStorageKey(longId)).toBe(`${LOBBY_FEATURES_STORAGE_PREFIX}${longId}`);
  });

  it('creates independent deterministic defaults', () => {
    const first = createDefaultLobbyFeatureState();
    const second = createDefaultLobbyFeatureState();
    first.claimedActivityIds.push('local-change');
    expect(second).toEqual({
      version: 1,
      claimedActivityIds: [],
      factionContributions: { gpt: 0, gemini: 0, claude: 0, deepseek: 0 },
      claimedBattlePassTierIds: [],
    });
  });
});

describe('versioned storage', () => {
  it('isolates guest and authenticated users', () => {
    const { storage } = createMemoryStorage();
    const userOneState = claimLobbyActivity(createDefaultLobbyFeatureState(), 'daily-roll-call');
    const guestState = contributeToLobbyFaction(createDefaultLobbyFeatureState(), 'deepseek', 4);
    saveLobbyFeatureState('user-1', userOneState, storage);
    saveLobbyFeatureState(null, guestState, storage);

    expect(loadLobbyFeatureState('user-1', storage).claimedActivityIds).toEqual(['daily-roll-call']);
    expect(loadLobbyFeatureState('user-2', storage)).toEqual(createDefaultLobbyFeatureState());
    expect(loadLobbyFeatureState(null, storage).factionContributions.deepseek).toBe(4);
  });

  it('resets a wrong-version user without disturbing another user state', () => {
    const { storage } = createMemoryStorage();
    const validState = claimLobbyActivity(createDefaultLobbyFeatureState(), 'daily-roll-call');
    saveLobbyFeatureState('valid-user', validState, storage);
    storage.setItem(
      getLobbyFeatureStorageKey('future-user'),
      JSON.stringify({ ...createDefaultLobbyFeatureState(), version: 999 }),
    );

    expect(loadLobbyFeatureState('future-user', storage)).toEqual(createDefaultLobbyFeatureState());
    expect(loadLobbyFeatureState('valid-user', storage)).toEqual(validState);
    expect(loadLobbyFeatureState(null, storage)).toEqual(createDefaultLobbyFeatureState());
  });

  it('writes only the active namespaced key', () => {
    const { storage, values } = createMemoryStorage();
    expect(saveLobbyFeatureState('account-a', createDefaultLobbyFeatureState(), storage)).toBe(true);
    expect([...values.keys()]).toEqual(['aiwerewolf:lobby-features:v1:account-a']);
  });

  it('round-trips local points for all four model factions', () => {
    const { storage } = createMemoryStorage();
    let state = createDefaultLobbyFeatureState();
    state = contributeToLobbyFaction(state, 'gpt', 1);
    state = contributeToLobbyFaction(state, 'gemini', 2);
    state = contributeToLobbyFaction(state, 'claude', 3);
    state = contributeToLobbyFaction(state, 'deepseek', 4);

    expect(saveLobbyFeatureState('model-fan', state, storage)).toBe(true);
    expect(loadLobbyFeatureState('model-fan', storage).factionContributions).toEqual({
      gpt: 1,
      gemini: 2,
      claude: 3,
      deepseek: 4,
    });
  });

  it.each([
    ['corrupt json', '{not-json'],
    ['wrong version', JSON.stringify({ ...createDefaultLobbyFeatureState(), version: 2 })],
    ['partial data', JSON.stringify({ version: 1, claimedActivityIds: [] })],
    ['invalid counter', JSON.stringify({ ...createDefaultLobbyFeatureState(), factionContributions: { gpt: -1, gemini: 0, claude: 0, deepseek: 0 } })],
  ])('falls back for %s', (_label, raw) => {
    const { storage } = createMemoryStorage();
    storage.setItem(getLobbyFeatureStorageKey('user-1'), raw);
    expect(loadLobbyFeatureState('user-1', storage)).toEqual(createDefaultLobbyFeatureState());
  });

  it('returns defaults when storage access is denied', () => {
    const deniedStorage = {
      getItem: () => { throw new DOMException('denied', 'SecurityError'); },
    } as unknown as Storage;
    expect(loadLobbyFeatureState('user-1', deniedStorage)).toEqual(createDefaultLobbyFeatureState());
  });

  it('keeps in-memory callers safe when storage quota rejects writes', () => {
    const quotaStorage = {
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    } as unknown as Storage;
    expect(saveLobbyFeatureState('user-1', createDefaultLobbyFeatureState(), quotaStorage)).toBe(false);
  });

  it('parses only complete version-one state', () => {
    const state = {
      ...createDefaultLobbyFeatureState(),
      claimedActivityIds: ['a'],
      claimedBattlePassTierIds: ['tier-1'],
    };
    expect(parseLobbyFeatureState(JSON.stringify(state))).toEqual(state);
  });
});

describe('local presentation transitions', () => {
  it('makes repeated activity and pass claims idempotent', () => {
    const initial = createDefaultLobbyFeatureState();
    const activityClaimed = claimLobbyActivity(initial, 'daily-roll-call');
    expect(claimLobbyActivity(activityClaimed, 'daily-roll-call')).toBe(activityClaimed);

    const tierClaimed = claimLobbyBattlePassTier(activityClaimed, 'tier-1');
    expect(claimLobbyBattlePassTier(tierClaimed, 'tier-1')).toBe(tierClaimed);
    expect(tierClaimed.claimedBattlePassTierIds).toEqual(['tier-1']);
  });

  it('claims every eligible pass tier once through the one-click transition', () => {
    const initial = claimLobbyBattlePassTier(createDefaultLobbyFeatureState(), 'tier-1');
    const claimed = claimLobbyBattlePassTiers(initial, ['tier-1', 'tier-2', 'tier-2', 'tier-3']);
    expect(claimed.claimedBattlePassTierIds).toEqual(['tier-1', 'tier-2', 'tier-3']);
    expect(claimLobbyBattlePassTiers(claimed, ['tier-1', 'tier-2', 'tier-3'])).toBe(claimed);
  });

  it('ignores invalid contributions and saturates large counters', () => {
    const initial = createDefaultLobbyFeatureState();
    expect(contributeToLobbyFaction(initial, 'gpt', 0)).toBe(initial);
    expect(contributeToLobbyFaction(initial, 'gpt', Number.POSITIVE_INFINITY)).toBe(initial);

    const next = contributeToLobbyFaction(initial, 'gpt', Number.MAX_SAFE_INTEGER);
    expect(next.factionContributions.gpt).toBe(MAX_LOCAL_FACTION_CONTRIBUTION);
    expect(next.factionContributions.deepseek).toBe(0);
  });
});
