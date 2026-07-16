/**
 * Layer 2 — LLM Adapter (free tier)
 * Routes requests to the unified provider-adapter Netlify Function first
 * (requested route validated server-side against its whitelist), then falls
 * back to the legacy genai-proxy with the exact original request shape.
 * On failure, returns empty string → caller falls back to speech library.
 */

export interface SpeechRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

const PROVIDER_ADAPTER_ENDPOINT = '/.netlify/functions/provider-adapter';
const GENAI_PROXY_ENDPOINT = '/.netlify/functions/genai-proxy';
const DEFAULT_ROUTE = 'gemini-2.5-flash';

const isLocalVite = () => {
  if (typeof window === 'undefined') return false;
  return new Set(['5173', '4173', '4174', '4175']).has(window.location.port);
};

// POST a JSON body and return response.text, or '' on any failure
// (non-OK status, network error, invalid JSON, missing text).
const postForText = async (endpoint: string, body: Record<string, unknown>): Promise<string> => {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return '';
    const json = await res.json();
    return typeof json.text === 'string' ? json.text : '';
  } catch {
    return '';
  }
};

export const generateWithGemini = async (req: SpeechRequest): Promise<string> => {
  if (isLocalVite()) return ''; // proxies not available locally

  const prompt = `${req.systemPrompt}\n\n---\n${req.userPrompt}`;
  const temperature = req.temperature ?? 0.95;

  // 1. Unified provider adapter with a requested route (whitelisted server-side).
  const adapterText = await postForText(PROVIDER_ADAPTER_ENDPOINT, {
    provider: DEFAULT_ROUTE,
    prompt,
    responseMimeType: 'application/json',
    temperature,
  });
  if (adapterText) return adapterText;

  // 2. Legacy genai-proxy fallback — exact original request shape.
  return postForText(GENAI_PROXY_ENDPOINT, {
    model: 'gemini-2.5-flash',
    prompt,
    responseMimeType: 'application/json',
    temperature,
  });
};

const extractJson = <T,>(raw: string): T | null => {
  if (!raw) return null;
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const candidate = start >= 0 && end >= start ? cleaned.slice(start, end + 1) : cleaned;
  try { return JSON.parse(candidate) as T; } catch { return null; }
};

export const generateSpeechWithLLM = async (
  systemPrompt: string,
  contextPrompt: string,
): Promise<{ zh: string; en: string } | null> => {
  const raw = await generateWithGemini({ systemPrompt, userPrompt: contextPrompt });
  if (!raw) return null;
  const parsed = extractJson<{ zh?: string; en?: string }>(raw);
  if (parsed?.zh) return { zh: parsed.zh, en: parsed.en || 'Speaks.' };
  return null;
};

export const generateActionWithLLM = async (
  prompt: string,
  validTargets: number[],
): Promise<{ targetId: number | null; reason?: string }> => {
  const raw = await generateWithGemini({ systemPrompt: '', userPrompt: prompt, temperature: 0.3 });
  if (!raw) return { targetId: null };
  const parsed = extractJson<{ targetId?: number; reason?: string }>(raw);
  if (parsed?.targetId && validTargets.includes(parsed.targetId)) {
    return { targetId: parsed.targetId, reason: parsed.reason };
  }
  return { targetId: null };
};
