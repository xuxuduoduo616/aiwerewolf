/** Browser adapter: exactly one server request; the server owns model fallback. */
import { DEFAULT_EXPRESSION_MODEL, type AIExpressionModelId } from './modelCatalog';

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
    if (!res.ok) return '';
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null && typeof (body as { text?: unknown }).text === 'string'
      ? (body as { text: string }).text : '';
  } catch {
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
  const parsed = extractJson<{ zh?: string; en?: string }>(await generateWithGemini({ systemPrompt, userPrompt: contextPrompt }, expressionModel));
  return parsed?.zh ? { zh: parsed.zh, en: parsed.en || 'Speaks.' } : null;
};
