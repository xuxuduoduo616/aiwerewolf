/**
 * Layer 2 — Gemini Adapter (free tier)
 * Calls Netlify Function proxy which uses Gemini 2.0 Flash (1500 RPD free).
 * On failure, returns empty string → caller falls back to speech library.
 */

export interface SpeechRequest {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

const isLocalVite = () => {
  if (typeof window === 'undefined') return false;
  return new Set(['5173', '4173', '4174', '4175']).has(window.location.port);
};

export const generateWithGemini = async (req: SpeechRequest): Promise<string> => {
  if (isLocalVite()) return ''; // proxy not available locally

  try {
    const res = await fetch('/.netlify/functions/genai-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        prompt: `${req.systemPrompt}\n\n---\n${req.userPrompt}`,
        responseMimeType: 'application/json',
        temperature: req.temperature ?? 0.95,
      }),
    });
    if (!res.ok) return '';
    const json = await res.json();
    return typeof json.text === 'string' ? json.text : '';
  } catch {
    return '';
  }
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
