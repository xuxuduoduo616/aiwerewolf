import {
  getAvailableExpressionModels,
  type AIExpressionModel,
} from './modelCatalog';

const PROVIDER_ADAPTER_ENDPOINT = '/.netlify/functions/provider-adapter';
const FETCH_TIMEOUT_MS = 12000;

const isLocalVite = () => {
  if (typeof window === 'undefined') return false;
  return new Set(['5173', '4173', '4174', '4175']).has(window.location.port);
};

const timeoutSignal = (): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
    : undefined;

/**
 * Fetch the server-verified model catalog. The parser intentionally treats any
 * partial or malformed response as Gemini-only so match setup remains usable
 * without accidentally exposing an unverified paid route.
 */
export const fetchAvailableExpressionModels = async (): Promise<readonly AIExpressionModel[]> => {
  if (isLocalVite()) return getAvailableExpressionModels(null);

  try {
    const res = await fetch(PROVIDER_ADAPTER_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: timeoutSignal(),
    });
    if (!res.ok) return getAvailableExpressionModels(null);
    return getAvailableExpressionModels(await res.json());
  } catch {
    return getAvailableExpressionModels(null);
  }
};
