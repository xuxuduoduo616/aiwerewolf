/** Browser adapter: exactly one server request; the server owns model fallback. */
import { DEFAULT_EXPRESSION_MODEL, type AIExpressionModelId } from './modelCatalog';
import { recordProviderOutcome } from '../services/matchTelemetry';
import type { Difficulty } from '../types';
import { resolveSingleRoute, validateDialogueSource, type DialogueSource } from './modelRouting';

export { fetchAvailableExpressionModels } from './providerCapabilities';

export interface SpeechRequest {
  systemPrompt: string;
  userPrompt: string;
  signal?: AbortSignal;
  difficulty?: Difficulty;
  onSource?: (source: DialogueSource) => void;
}

const PROVIDER_ADAPTER_ENDPOINT = '/.netlify/functions/provider-adapter';
const FETCH_TIMEOUT_MS = 12000;

const isLocalVite = () => typeof window !== 'undefined'
  && new Set(['5173', '4173', '4174', '4175']).has(window.location.port);
const requestSignal = (external?: AbortSignal, timeoutMs = FETCH_TIMEOUT_MS) => {
  const controller = new AbortController();
  const cancel = () => controller.abort(external?.reason);
  if (external?.aborted) cancel();
  else external?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(() => controller.abort(new DOMException('Provider timed out', 'TimeoutError')), timeoutMs);
  return { signal: controller.signal, cleanup: () => { clearTimeout(timeout); external?.removeEventListener('abort', cancel); } };
};
const isTimeoutError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'TimeoutError' || name === 'AbortError';
};

export const generateWithGemini = async (
  req: SpeechRequest,
  expressionModel: AIExpressionModelId = DEFAULT_EXPRESSION_MODEL,
): Promise<string> => {
  if (isLocalVite() || req.signal?.aborted) return '';
  // Resolve virtual modes locally; pool IDs never leave the browser.
  const route = resolveSingleRoute(expressionModel, req.difficulty ?? 'normal');
  const deepseek = route.startsWith('deepseek-');
  const request = requestSignal(req.signal, deepseek ? 48000 : FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(PROVIDER_ADAPTER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: route,
        prompt: `${req.systemPrompt}\n\n---\n${req.userPrompt}`,
        responseMimeType: 'application/json',
        ...(req.difficulty !== undefined ? { difficulty: req.difficulty } : {}),
      }),
      signal: request.signal,
    });
    if (!res.ok) {
      recordProviderOutcome('provider_failed');
      return '';
    }
    let body: { text?: unknown; cost_estimate?: unknown; model_used?: unknown; fallback_used?: unknown } | null;
    try {
      body = await res.json() as { text?: unknown; cost_estimate?: unknown; model_used?: unknown; fallback_used?: unknown } | null;
    } catch {
      recordProviderOutcome('provider_unparsable');
      return '';
    }
    const text = typeof body?.text === 'string' ? body.text : null;
    if (req.signal?.aborted) return '';
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
    req.onSource?.(validateDialogueSource(route, body?.model_used, body?.fallback_used));
    recordProviderOutcome('provider_success', {
      costUSD: typeof body?.cost_estimate === 'number' ? body.cost_estimate : 0,
    });
    return text;
  } catch (error) {
    if (req.signal?.aborted) return '';
    recordProviderOutcome(isTimeoutError(error) ? 'provider_timeout' : 'provider_failed');
    return '';
  } finally {
    request.cleanup();
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
  difficulty?: Difficulty,
  signal?: AbortSignal,
  onSource?: (source: DialogueSource) => void,
): Promise<{ zh: string; en: string } | null> => {
  const parsed = extractJson<{ zh?: unknown; en?: unknown }>(await generateWithGemini({ systemPrompt, userPrompt: contextPrompt, difficulty, signal, onSource }, expressionModel));
  const zh = typeof parsed?.zh === 'string' ? parsed.zh.trim() : '';
  const en = typeof parsed?.en === 'string' ? parsed.en.trim() : '';
  return zh || en ? { zh, en } : null;
};

/** Night chat has its own schema; it is not a bilingual daytime speech. */
export const generateWolfChatWithLLM = async (
  systemPrompt: string,
  contextPrompt: string,
  expressionModel: AIExpressionModelId = DEFAULT_EXPRESSION_MODEL,
  signal?: AbortSignal,
  difficulty?: Difficulty,
  onSource?: (source: DialogueSource) => void,
): Promise<unknown[]> => {
  const parsed = extractJson<{ messages?: unknown }>(await generateWithGemini({ systemPrompt, userPrompt: contextPrompt, signal, difficulty, onSource }, expressionModel));
  return Array.isArray(parsed?.messages) ? parsed.messages : [];
};
