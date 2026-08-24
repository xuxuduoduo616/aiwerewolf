import { describe, expect, it } from 'vitest';
import {
  economyRouteHash,
  navigateEconomyRoute,
  parseEconomyRoute,
  readEconomyRoute,
  type EconomyHashRuntime,
} from './routes';

const createHistoryRuntime = (initialHash: string) => {
  const entries = [initialHash];
  let index = 0;
  let notifications = 0;
  const runtime: EconomyHashRuntime = {
    readHash: () => entries[index],
    pushHash: hash => {
      entries.splice(index + 1);
      entries.push(hash);
      index = entries.length - 1;
    },
    notifySameHash: () => {
      notifications += 1;
    },
  };
  return {
    runtime,
    back: () => { index = Math.max(0, index - 1); },
    forward: () => { index = Math.min(entries.length - 1, index + 1); },
    notifications: () => notifications,
  };
};

describe('economy deep links', () => {
  it('round-trips every supported route without a blank destination', () => {
    const routes = [
      { page: 'lobby' } as const,
      { page: 'skin-store', season: 'all', section: 'skins' } as const,
      { page: 'skin-store', season: 'tidal', section: 'skins' } as const,
      { page: 'skin-store', season: 'all', section: 'coin-packs' } as const,
      { page: 'online-qualifier' } as const,
      { page: 'daily-check-in' } as const,
      { page: 'economy-history' } as const,
    ];
    for (const route of routes) expect(parseEconomyRoute(economyRouteHash(route))).toEqual(route);
  });

  it('fails unknown or malformed paths safely back to the lobby', () => {
    expect(parseEconomyRoute('#/missing')).toEqual({ page: 'lobby' });
    expect(parseEconomyRoute('')).toEqual({ page: 'lobby' });
    expect(parseEconomyRoute('#/shop/skins?season=unknown')).toEqual({ page: 'skin-store', season: 'all', section: 'skins' });
  });

  it('restores a hash deep link on initial load and refresh', () => {
    const firstLoad = createHistoryRuntime('#/shop/skins?season=tidal');
    expect(readEconomyRoute(firstLoad.runtime)).toEqual({
      page: 'skin-store', season: 'tidal', section: 'skins',
    });

    const refreshedDocument = createHistoryRuntime(firstLoad.runtime.readHash());
    expect(readEconomyRoute(refreshedDocument.runtime)).toEqual({
      page: 'skin-store', season: 'tidal', section: 'skins',
    });
  });

  it('supports browser Back/Forward and visual Back through pushed hashes', () => {
    const history = createHistoryRuntime('#/lobby');
    navigateEconomyRoute({ page: 'daily-check-in' }, history.runtime);
    navigateEconomyRoute({ page: 'economy-history' }, history.runtime);
    expect(readEconomyRoute(history.runtime)).toEqual({ page: 'economy-history' });

    history.back();
    expect(readEconomyRoute(history.runtime)).toEqual({ page: 'daily-check-in' });
    history.forward();
    expect(readEconomyRoute(history.runtime)).toEqual({ page: 'economy-history' });

    // The visual Back buttons navigate to lobby via the same pushed route API.
    navigateEconomyRoute({ page: 'lobby' }, history.runtime);
    expect(readEconomyRoute(history.runtime)).toEqual({ page: 'lobby' });
    history.back();
    expect(readEconomyRoute(history.runtime)).toEqual({ page: 'economy-history' });
  });

  it('notifies listeners when navigating to the already-active route', () => {
    const history = createHistoryRuntime('#/lobby');
    navigateEconomyRoute({ page: 'lobby' }, history.runtime);
    expect(history.notifications()).toBe(1);
    expect(history.runtime.readHash()).toBe('#/lobby');
  });
});
