/** Browser adapter: exactly one server request; the server owns model fallback. */
import { DEFAULT_EXPRESSION_MODEL, type AIExpressionModelId } from './modelCatalog';
import { recordProviderOutcome } from '../services/matchTelemetry';

export { fetchAvailableExpressionModels } from './providerCapabilities';

export interface SpeechRequest {
  systemPrompt: string;
  userPrompt: string;
}

const PROVIDER_ADAPTER_ENDPOINT = '/.netlify/functions/provider-adapter';
const FETCH_TIMEOUT_MS = 12000;

const isLocalVite = () => typeof window !== 'undefined'
  && new Set(['5173', '4173', '4174', '4175']).has(window.location.port);
const timeoutSignal = (): AbortSignal | undefined =>
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined;
const isTimeoutError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'TimeoutError' || name === 'AbortError';
};

export const generateWithGemini = async (
  req: SpeechRequest,
  expressionModel: AIExpressionModelId = DEFAULT_EXPRESSION_MODEL,
): Promise<string> => {
  if (isLocalVite()) return '';
  try {
    const res = await fetch(PROVIDER_ADAPTER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: expressionModel,
        prompt: `${req.systemPrompt}\n\n---\n${req.userPrompt}`,
        responseMimeType: 'application/json',
      }),
      signal: timeoutSignal(),
    });
    if (!res.ok) {
      recordProviderOutcome('provider_failed');
      return '';
    }
    let body: { text?: unknown; cost_estimate?: unknown } | null;
    try {
      body = await res.json() as { text?: unknown; cost_estimate?: unknown } | null;
    } catch {
      recordProviderOutcome('provider_unparsable');
      return '';
    }
    const text = typeof body?.text === 'string' ? body.text : null;
    if (text === null) {
      recordProviderOutcome('provider_unparsable');
      return '';
    }
    // The server returns 200 with empty text for its local fallback; that is a
    // provider failure for the expression layer, never a successful speech.
    if (!text) {
      recordProviderOutcome('provider_failed');
      return '';
    }
    recordProviderOutcome('provider_success', {
      costUSD: typeof body?.cost_estimate === 'number' ? body.cost_estimate : 0,
    });
    return text;
  } catch (error) {
    recordProviderOutcome(isTimeoutError(error) ? 'provider_timeout' : 'provider_failed');
    return '';
  }
};

const extractJson = <T,>(raw: string): T | null => {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  try { return JSON.parse(start >= 0 && end >= start ? cleaned.slice(start, end + 1) : cleaned) as T; } catch { return null; }
};

export const generateSpeechWithLLM = async (
  systemPrompt: string,
  contextPrompt: string,
  expressionModel: AIExpressionModelId = DEFAULT_EXPRESSION_MODEL,
): Promise<{ zh: string; en: string } | null> => {
  const parsed = extractJson<{ zh?: unknown; en?: unknown }>(await generateWithGemini({ systemPrompt, userPrompt: contextPrompt }, expressionModel));
  const zh = typeof parsed?.zh === 'string' ? parsed.zh.trim() : '';
  const en = typeof parsed?.en === 'string' ? parsed.en.trim() : '';
  return zh || en ? { zh, en } : null;
};

/** Night chat has its own schema; it is not a bilingual daytime speech. */
export const generateWolfChatWithLLM = async (
  systemPrompt: string,
  contextPrompt: string,
  expressionModel: AIExpressionModelId = DEFAULT_EXPRESSION_MODEL,
): Promise<unknown[]> => {
  const parsed = extractJson<{ messages?: unknown }>(await generateWithGemini({ systemPrompt, userPrompt: contextPrompt }, expressionModel));
  return Array.isArray(parsed?.messages) ? parsed.messages : [];
};
