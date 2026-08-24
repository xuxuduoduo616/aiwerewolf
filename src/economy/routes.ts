export type EconomyRoute =
  | { page: 'lobby' }
  | { page: 'skin-store'; season: 'all' | 'tidal'; section: 'skins' | 'coin-packs' }
  | { page: 'online-qualifier' }
  | { page: 'daily-check-in' }
  | { page: 'economy-history' };

export interface EconomyHashRuntime {
  readHash: () => string;
  pushHash: (hash: string) => void;
  notifySameHash: () => void;
}

export const parseEconomyRoute = (hash: string): EconomyRoute => {
  const normalized = hash.startsWith('#') ? hash.slice(1) : hash;
  const [pathPart, queryPart = ''] = normalized.split('?');
  const path = `/${pathPart.replace(/^\/+|\/+$/g, '')}`;
  const query = new URLSearchParams(queryPart);

  switch (path) {
    case '/shop/skins':
      return {
        page: 'skin-store',
        season: query.get('season') === 'tidal' ? 'tidal' : 'all',
        section: 'skins',
      };
    case '/shop/coin-packs':
      return { page: 'skin-store', season: 'all', section: 'coin-packs' };
    case '/online-qualifier':
      return { page: 'online-qualifier' };
    case '/daily-check-in':
      return { page: 'daily-check-in' };
    case '/economy/history':
      return { page: 'economy-history' };
    case '/':
    case '/lobby':
    default:
      return { page: 'lobby' };
  }
};

export const economyRouteHash = (route: EconomyRoute): string => {
  switch (route.page) {
    case 'lobby':
      return '#/lobby';
    case 'skin-store':
      if (route.section === 'coin-packs') return '#/shop/coin-packs';
      return route.season === 'tidal' ? '#/shop/skins?season=tidal' : '#/shop/skins';
    case 'online-qualifier':
      return '#/online-qualifier';
    case 'daily-check-in':
      return '#/daily-check-in';
    case 'economy-history':
      return '#/economy/history';
  }
};

export const createBrowserEconomyHashRuntime = (): EconomyHashRuntime | null => {
  if (typeof window === 'undefined') return null;
  return {
    readHash: () => window.location.hash,
    pushHash: hash => {
      window.location.hash = hash;
    },
    notifySameHash: () => window.dispatchEvent(new HashChangeEvent('hashchange')),
  };
};

export const readEconomyRoute = (
  runtime: EconomyHashRuntime | null = createBrowserEconomyHashRuntime(),
): EconomyRoute => parseEconomyRoute(runtime?.readHash() ?? '');

/** Pushes a hash entry so browser Back/Forward and visual Back share one route model. */
export const navigateEconomyRoute = (
  route: EconomyRoute,
  runtime: EconomyHashRuntime | null = createBrowserEconomyHashRuntime(),
): void => {
  if (!runtime) return;
  const nextHash = economyRouteHash(route);
  if (runtime.readHash() === nextHash) {
    runtime.notifySameHash();
    return;
  }
  runtime.pushHash(nextHash);
};

// Kept as a compatibility alias for existing callers; navigation is a push,
// not history.replaceState.
export const replaceEconomyRoute = navigateEconomyRoute;
