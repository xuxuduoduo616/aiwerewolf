// Server-only expression adapter. Rules and action selection never use it.
const { GoogleGenAI, ThinkingLevel } = require('@google/genai');

const MODEL_REGISTRY = Object.freeze({
  'gemini-3.6-flash': Object.freeze({
    model: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash',
    inputCostPer1kTokens: 0.0015,
    outputCostPer1kTokens: 0.0075,
    maxOutputTokens: 256,
    timeout: 12000,
    maxRetries: 0,
  }),
  'gemini-3.8-flash': Object.freeze({
    model: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    // Netlify AI Gateway / Gemini published rates, checked 2026-11-21:
    // USD 0.75 input / USD 3.75 output per 1M tokens.
    inputCostPer1kTokens: 0.00075,
    outputCostPer1kTokens: 0.00375,
    maxOutputTokens: 256,
    timeout: 12000,
    maxRetries: 0,
  }),
  'gemini-2.5-flash': Object.freeze({
    model: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    // Google Gemini API standard paid text rates, checked 2026-08-06.
    inputCostPer1kTokens: 0.0003,
    outputCostPer1kTokens: 0.0025,
    maxOutputTokens: 256,
    timeout: 12000,
    maxRetries: 0,
  }),
  'deepseek-flash': Object.freeze({
    model: 'deepseek-flash',
    // Peak (cache-miss) USD rates; official pricing checked 2026-11-18.
    inputCostPer1kTokens: 0.0003,
    outputCostPer1kTokens: 0.0012,
    timeout: 45000,
    maxRetries: 0,
  }),
  'deepseek-v4-pro': Object.freeze({
    model: 'deepseek-v4-pro',
    inputCostPer1kTokens: 0.00132,
    outputCostPer1kTokens: 0.00396,
    timeout: 45000,
    maxRetries: 0,
  }),
  'doubao-seed-1.6-flash': Object.freeze({
    model: 'doubao-seed-1.6-flash',
    label: 'Doubao Seed 1.6 Flash',
    thinking: Object.freeze({ type: 'disabled' }),
    // Volcano Ark model version id. ARK_DOUBAO_MODEL overrides it when the
    // account exposes a different version label in the console.
    upstreamModel: 'doubao-seed-1-6-flash-250615',
    // Doubao Seed 1.6 Flash standard rates, 0-32K tier, checked 2026-11-20:
    // CNY 0.15 input / CNY 1.5 output per 1M tokens, converted at 7.10 CNY/USD
    // so the existing USD budget guard keeps one currency.
    inputCostPer1kTokens: 0.000021127,
    outputCostPer1kTokens: 0.000211268,
    // Expression-only speech never needs the model's long-form budget.
    maxOutputTokens: 512,
    timeout: 20000,
    maxRetries: 0,
  }),
  'doubao-seed-character': Object.freeze({
    model: 'doubao-seed-character',
    label: 'Doubao Seed Character',
    upstreamModel: 'doubao-seed-character-260628',
    inputCostPer1kTokens: 0.000112676,
    outputCostPer1kTokens: 0.000281690,
    maxOutputTokens: 512,
    timeout: 20000,
    maxRetries: 0,
  }),
  'doubao-seed-2.1-lite': Object.freeze({
    model: 'doubao-seed-2.1-lite',
    label: 'Doubao Seed 2.1 Lite',
    upstreamModel: 'doubao-seed-2-1-lite-260915',
    thinking: Object.freeze({ type: 'disabled' }),
    inputCostPer1kTokens: 0.000112676,
    outputCostPer1kTokens: 0.000380282,
    maxOutputTokens: 512,
    timeout: 20000,
    maxRetries: 0,
  }),
  'local-fallback': Object.freeze({ model: 'local-fallback', timeout: 0, maxRetries: 0 }),
});

const PRIMARY_MODEL = 'gemini-3.6-flash';
const GEMINI_3_8_MODEL = 'gemini-3.8-flash';
const SECONDARY_MODEL = 'gemini-2.5-flash';
const GEMINI_MODEL_IDS = Object.freeze([PRIMARY_MODEL, GEMINI_3_8_MODEL, SECONDARY_MODEL]);
const isGeminiModel = id => GEMINI_MODEL_IDS.includes(id);
const AI_GATEWAY_PROVIDERS_URL = 'https://api.netlify.com/api/v1/ai-gateway/providers';
const LOCAL_FALLBACK = 'local-fallback';
const DEEPSEEK_AUTO = 'deepseek-auto';
const DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DOUBAO_MODEL = 'doubao-seed-1.6-flash';
const DOUBAO_MODEL_IDS = Object.freeze([DOUBAO_MODEL, 'doubao-seed-character', 'doubao-seed-2.1-lite']);
const isDoubaoModel = id => DOUBAO_MODEL_IDS.includes(id);
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
const DIFFICULTY_PROFILES = Object.freeze({
  easy: Object.freeze({ model: 'deepseek-flash', effort: 'low', maxTokens: 2048 }),
  normal: Object.freeze({ model: 'deepseek-flash', effort: 'high', maxTokens: 4096 }),
  hard: Object.freeze({ model: 'deepseek-v4-pro', effort: 'max', maxTokens: 8192 }),
});
const MAX_PROMPT_LEN = 6000;
const COST_CEILING_PER_CALL = 0.005;
const DEEPSEEK_COST_CEILING_PER_CALL = 0.05;
const DEFAULT_DAILY_BUDGET_USD = 0.05;
const CAPABILITY_CACHE_MS = 60_000;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const CIRCUIT_FAILURE_THRESHOLD = 2;
const CIRCUIT_COOLDOWN_MS = 60_000;
let capabilityCache = null;
let deepseekCapabilityCache = null;
let doubaoCapabilityCache = null;
let budgetState = { day: '', spent: 0 };
const rateBuckets = new Map();
const circuits = new Map();
const requestCounters = new Map();

const estimateTokens = (text) => Math.ceil(String(text || '').length / 4);
const estimateCost = (model, inputTokens, maxTokens = MODEL_REGISTRY[model]?.maxOutputTokens) => {
  const cfg = MODEL_REGISTRY[model];
  if (!cfg || !cfg.inputCostPer1kTokens) return Infinity;
  return (inputTokens / 1000) * cfg.inputCostPer1kTokens
    + (maxTokens / 1000) * cfg.outputCostPer1kTokens;
};
const dayKey = () => new Date().toISOString().slice(0, 10);
const dailyBudget = () => {
  const value = Number(process.env.ADAPTER_DAILY_BUDGET_USD);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_DAILY_BUDGET_USD;
};
const canSpend = (cost, ceiling = COST_CEILING_PER_CALL) => {
  const day = dayKey();
  if (budgetState.day !== day) budgetState = { day, spent: 0 };
  return Number.isFinite(cost) && cost <= ceiling && budgetState.spent + cost <= dailyBudget();
};
const recordSpend = (cost) => { budgetState.spent += cost; };
const incrementCounter = (model) => {
  requestCounters.set(model, (requestCounters.get(model) || 0) + 1);
};
const checkRateLimit = (ip) => {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + RATE_WINDOW_MS; }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  return bucket.count <= RATE_LIMIT;
};
const classifyError = (error) => {
  const status = Number(error?.status || error?.statusCode || 0);
  if (error?.message === 'timeout' || error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'timeout';
  if (status === 401 || status === 403) return 'authentication';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'upstream';
  return 'unavailable';
};
const circuitAllows = (model) => {
  const state = circuits.get(model);
  if (!state) return true;
  if (state.openUntil > Date.now()) return false;
  if (state.openUntil) circuits.delete(model);
  return true;
};
// H1-D observability: one JSON line per model failure / fallback. The line is
// an enum-only whitelist (event, model id, cause, fallback) so no prompt,
// model output, client IP or origin can leak into Netlify function logs.
const PROVIDER_EVENT_BY_CAUSE = Object.freeze({
  timeout: 'provider_timeout',
  'rate-limit': 'provider_rate_limited',
  authentication: 'provider_auth_error',
  upstream: 'provider_upstream_error',
  unavailable: 'provider_fallback',
});
const logProviderEvent = (event, model, cause, fallback) => {
  if (typeof console === 'undefined') return;
  console.warn(JSON.stringify({ event, model, cause, fallback }));
};
const recordCircuitSuccess = (model) => circuits.delete(model);
const recordCircuitFailure = (model, error) => {
  const current = circuits.get(model) || { failures: 0, openUntil: 0, lastError: '' };
  const failures = current.failures + 1;
  circuits.set(model, {
    failures,
    openUntil: failures >= CIRCUIT_FAILURE_THRESHOLD ? Date.now() + CIRCUIT_COOLDOWN_MS : 0,
    lastError: classifyError(error),
  });
};
const getApiKey = () => process.env.GEMINI_API_KEY || process.env.API_KEY || '';
const getHeader = (headers, name) => {
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === name);
  return typeof entry?.[1] === 'string' ? entry[1] : '';
};
const getAllowedOrigin = (headers) => {
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
  const origin = getHeader(headers, 'origin');
  if (origin) return allowed.includes(origin) ? origin : null;

  const host = getHeader(headers, 'host');
  const fetchSite = getHeader(headers, 'sec-fetch-site').toLowerCase();
  const referer = getHeader(headers, 'referer');
  for (const allowedOrigin of allowed) {
    try {
      const parsed = new URL(allowedOrigin);
      if (parsed.host !== host) continue;
      if (fetchSite === 'same-origin' || fetchSite === 'same-site') return allowedOrigin;
      if (referer && new URL(referer).origin === allowedOrigin) return allowedOrigin;
    } catch {
      // An invalid configured value never widens access.
    }
  }
  return null;
};
const headersFor = (allowedOrigin) => ({
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  ...(allowedOrigin ? {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  } : {}),
});
const modelNameMatches = (value, id) => value === id || value === `models/${id}`;
const withTimeout = async (operation, timeout, onTimeout = () => {}) => {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => { onTimeout(); reject(new Error('timeout')); }, timeout); }),
    ]);
  } finally { clearTimeout(timer); }
};

const deepseekJson = async (path, options, timeout) => {
  const controller = new AbortController();
  try {
    return await withTimeout((async () => {
      const response = await fetch(`${DEEPSEEK_BASE_URL}${path}`, {
        ...options,
        redirect: 'error',
        headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw Object.assign(new Error('provider-error'), { status: response.status });
      return response.json();
    })(), timeout, () => controller.abort());
  } finally { controller.abort(); }
};

// Volcano Ark exposes the same OpenAI-compatible envelope as DeepSeek, so the
// transport is shared and only the base URL, key and model id differ.
const arkJson = async (path, options, timeout) => {
  const controller = new AbortController();
  try {
    return await withTimeout((async () => {
      const response = await fetch(`${ARK_BASE_URL}${path}`, {
        ...options,
        redirect: 'error',
        headers: { Authorization: `Bearer ${process.env.ARK_API_KEY}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw Object.assign(new Error('provider-error'), { status: response.status });
      return response.json();
    })(), timeout, () => controller.abort());
  } finally { controller.abort(); }
};

// When GOOGLE_GEMINI_BASE_URL is injected by Netlify AI Gateway, the gateway's
// Gemini inference proxy rejects GET /v1beta/models/{model} (HTTP 403) and
// publishes its live model directory at the AI Gateway providers endpoint.
const gatewayGeminiModels = async () => {
  if (!process.env.GOOGLE_GEMINI_BASE_URL) return [];
  const controller = new AbortController();
  try {
    const result = await withTimeout((async () => {
      const response = await fetch(AI_GATEWAY_PROVIDERS_URL, {
        method: 'GET',
        redirect: 'error',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw Object.assign(new Error('provider-error'), { status: response.status });
      return response.json();
    })(), 5000, () => controller.abort());
    const models = result?.providers?.gemini?.models;
    const listed = Array.isArray(models)
      ? new Set(models)
      : (models && typeof models === 'object' ? new Set(Object.keys(models)) : new Set());
    return GEMINI_MODEL_IDS.filter(id => listed.has(id));
  } catch {
    return [];
  } finally {
    controller.abort();
  }
};

const verifiedCapabilities = async () => {
  const key = getApiKey();
  if (!key) return null;
  if (capabilityCache && Date.now() - capabilityCache.at < CAPABILITY_CACHE_MS) return capabilityCache.value;
  try {
    let verified = await gatewayGeminiModels();
    if (!verified.length && !process.env.GOOGLE_GEMINI_BASE_URL) {
      const client = new GoogleGenAI({ apiKey: key });
      const results = await Promise.allSettled(GEMINI_MODEL_IDS.map(model =>
        withTimeout(client.models.get({ model }), 5000)));
      verified = GEMINI_MODEL_IDS.filter((id, index) =>
        results[index].status === 'fulfilled' && modelNameMatches(results[index].value?.name, id));
    }
    const defaultModel = verified.includes(PRIMARY_MODEL)
      ? PRIMARY_MODEL
      : verified.includes(GEMINI_3_8_MODEL)
        ? GEMINI_3_8_MODEL
        : SECONDARY_MODEL;
    const value = {
      default_model: defaultModel,
      models: [
        ...(verified.includes(PRIMARY_MODEL) ? [{ id: PRIMARY_MODEL, label: 'Gemini 3.6 Flash' }] : []),
        ...(verified.includes(GEMINI_3_8_MODEL) ? [{ id: GEMINI_3_8_MODEL, label: 'Gemini 3.8 Flash' }] : []),
        { id: SECONDARY_MODEL, label: 'Gemini 2.5 Flash' },
      ],
      verified_models: verified,
    };
    if (verified.length) capabilityCache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
};
const fallbackCapabilities = () => ({
  default_model: SECONDARY_MODEL,
  models: [{ id: SECONDARY_MODEL, label: 'Gemini 2.5 Flash' }],
  verified_models: [],
});

const verifiedDeepseekModels = async () => {
  if (!process.env.DEEPSEEK_API_KEY) return [];
  if (deepseekCapabilityCache && Date.now() - deepseekCapabilityCache.at < CAPABILITY_CACHE_MS) return deepseekCapabilityCache.models;
  try {
    const result = await deepseekJson('/models', { method: 'GET' }, 5000);
    if (!Array.isArray(result?.data)) return [];
    const models = DEEPSEEK_MODELS.filter(id => result.data.some(model => model?.id === id));
    // The automatic route requires both exact IDs; discovery makes no paid calls.
    if (models.length) deepseekCapabilityCache = { at: Date.now(), models };
    return models;
  } catch { return []; }
};

const arkModelId = id => {
  const override = id === DOUBAO_MODEL ? process.env.ARK_DOUBAO_MODEL : '';
  return String(override || MODEL_REGISTRY[id].upstreamModel).trim();
};

const verifiedDoubaoModels = async () => {
  if (!process.env.ARK_API_KEY) return [];
  if (doubaoCapabilityCache && Date.now() - doubaoCapabilityCache.at < CAPABILITY_CACHE_MS) return doubaoCapabilityCache.models;
  try {
    // Match only the configured version or exact catalog ID for each route.
    const result = await arkJson('/models', { method: 'GET' }, 5000);
    if (!Array.isArray(result?.data)) return [];
    const listed = new Set(result.data.map(model => model?.id));
    const models = DOUBAO_MODEL_IDS.filter(id => listed.has(arkModelId(id)) || listed.has(id));
    doubaoCapabilityCache = { at: Date.now(), models };
    return models;
  } catch { return []; }
};

const capabilities = async () => {
  const [gemini, deepseek, doubao] = await Promise.all([verifiedCapabilities(), verifiedDeepseekModels(), verifiedDoubaoModels()]);
  const base = gemini || fallbackCapabilities();
  const doubaoEntries = doubao.map(id => ({ id, label: MODEL_REGISTRY[id].label }));
  if (!deepseek.length) {
    return doubao.length ? { ...base, verified_models: [...base.verified_models, ...doubao], models: [...base.models, ...doubaoEntries] } : base;
  }
  return {
    default_model: deepseek.length === DEEPSEEK_MODELS.length ? DEEPSEEK_AUTO : deepseek[0],
    verified_models: [...deepseek, ...doubao, ...base.verified_models],
    models: [
      ...(deepseek.length === DEEPSEEK_MODELS.length ? [{ id: DEEPSEEK_AUTO, label: 'Automatic · DeepSeek by difficulty' }] : []),
      ...deepseek.map(id => ({ id, label: id === 'deepseek-flash' ? 'DeepSeek V4.1 Flash' : 'DeepSeek V4 Pro' })),
      ...doubaoEntries,
      ...base.models,
    ],
  };
};

// Provider replies occasionally arrive inside a fenced code block; the client
// parser already tolerates that, so the server check must accept it too.
const parseJsonObject = (text) => {
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const parsed = JSON.parse(start >= 0 && end >= start ? cleaned.slice(start, end + 1) : cleaned);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid-json');
  return parsed;
};

// Reserve the full completion budget before the call, then settle only a
// validated usage report. Missing or impossible usage keeps the reservation.
const settleUsage = (model, usage, maxTokens, reservation, reservationDay, inputTokens) => {
  let charged = reservation;
  if (Number.isInteger(usage?.prompt_tokens) && usage.prompt_tokens >= 0 && usage.prompt_tokens <= inputTokens
    && Number.isInteger(usage?.completion_tokens) && usage.completion_tokens >= 0 && usage.completion_tokens <= maxTokens) {
    charged = estimateCost(model, usage.prompt_tokens, usage.completion_tokens);
    if (budgetState.day === reservationDay) budgetState.spent = Math.max(0, budgetState.spent - reservation + charged);
  }
  return charged;
};

const tryDeepseek = async (model, prompt, responseMimeType, profile, cost, inputTokens) => {
  if (!process.env.DEEPSEEK_API_KEY || !canSpend(cost, DEEPSEEK_COST_CEILING_PER_CALL) || !circuitAllows(model)) return { text: null };
  const reservationDay = dayKey();
  try {
    recordSpend(cost);
    incrementCounter(model);
    const response = await deepseekJson('/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: responseMimeType === 'application/json' ? 'Return a complete JSON object matching the requested game dialogue schema. Do not include reasoning in the answer.' : 'Return only the requested game dialogue.' },
          { role: 'user', content: prompt },
        ],
        thinking: { type: 'enabled' },
        reasoning_effort: profile.effort,
        max_tokens: profile.maxTokens,
        ...(responseMimeType === 'application/json' ? { response_format: { type: 'json_object' } } : {}),
      }),
    }, MODEL_REGISTRY[model].timeout);
    const choice = response?.choices?.[0];
    const text = choice?.message?.content;
    if (choice?.finish_reason !== 'stop' || typeof text !== 'string' || !text.trim()) throw new Error('incomplete-response');
    if (responseMimeType === 'application/json') {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid-json');
    }
    // Reserve the complete reasoning budget before the call, then settle only
    // valid usage. Reasoning tokens are included in completion_tokens. Missing
    // usage or failed calls retain the reservation (conservative accounting).
    const charged = settleUsage(model, response?.usage, profile.maxTokens, cost, reservationDay, inputTokens);
    recordCircuitSuccess(model);
    return { text, cost: charged };
  } catch (error) {
    const cause = classifyError(error);
    recordCircuitFailure(model, error);
    logProviderEvent(PROVIDER_EVENT_BY_CAUSE[cause], model, cause, true);
    return { text: null, cause };
  }
};

// Doubao is an expression-only route: reasoning is disabled by default so the
// seat answers inside the Netlify request budget. If Ark rejects an optional
// parameter (HTTP 400) the request is retried once with the minimal body.
const tryDoubao = async (model, prompt, responseMimeType, cost, inputTokens) => {
  const cfg = MODEL_REGISTRY[model];
  if (!process.env.ARK_API_KEY || !canSpend(cost) || !circuitAllows(model)) return { text: null };
  const reservationDay = dayKey();
  const messages = [
    { role: 'system', content: responseMimeType === 'application/json' ? 'Return a complete JSON object matching the requested game dialogue schema. Do not include reasoning in the answer.' : 'Return only the requested game dialogue.' },
    { role: 'user', content: prompt },
  ];
  const body = {
    model: arkModelId(model),
    messages,
    max_tokens: cfg.maxOutputTokens,
    ...(cfg.thinking ? { thinking: cfg.thinking } : {}),
    ...(responseMimeType === 'application/json' ? { response_format: { type: 'json_object' } } : {}),
  };
  const minimalBody = {
    model: body.model,
    messages,
    max_tokens: cfg.maxOutputTokens,
    // Seed 2.1 Lite must disable thinking even on the compatibility retry.
    ...(model === 'doubao-seed-2.1-lite' ? { thinking: cfg.thinking } : {}),
  };
  try {
    recordSpend(cost);
    incrementCounter(model);
    let response;
    try {
      response = await arkJson('/chat/completions', { method: 'POST', body: JSON.stringify(body) }, cfg.timeout);
    } catch (error) {
      if (Number(error?.status) !== 400) throw error;
      response = await arkJson('/chat/completions', { method: 'POST', body: JSON.stringify(minimalBody) }, cfg.timeout);
    }
    const choice = response?.choices?.[0];
    const text = choice?.message?.content;
    if (choice?.finish_reason !== 'stop' || typeof text !== 'string' || !text.trim()) throw new Error('incomplete-response');
    if (responseMimeType === 'application/json') parseJsonObject(text);
    const charged = settleUsage(model, response?.usage, cfg.maxOutputTokens, cost, reservationDay, inputTokens);
    recordCircuitSuccess(model);
    return { text, cost: charged };
  } catch (error) {
    const cause = classifyError(error);
    recordCircuitFailure(model, error);
    logProviderEvent(PROVIDER_EVENT_BY_CAUSE[cause], model, cause, true);
    return { text: null, cause };
  }
};

const generationConfig = (model, responseMimeType) => {
  const config = { responseMimeType, maxOutputTokens: MODEL_REGISTRY[model].maxOutputTokens };
  if (model === PRIMARY_MODEL || model === GEMINI_3_8_MODEL) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel?.MINIMAL || 'MINIMAL' };
  }
  return config;
};
const tryModel = async (model, prompt, responseMimeType, cost) => {
  const key = getApiKey();
  if (!key || !canSpend(cost) || !circuitAllows(model)) return { text: null, cause: 'unavailable', skipped: true };
  const cfg = MODEL_REGISTRY[model];
  try {
    recordSpend(cost);
    incrementCounter(model);
    const client = new GoogleGenAI({ apiKey: key });
    const response = await withTimeout(client.models.generateContent({
      model,
      contents: prompt,
      config: generationConfig(model, responseMimeType),
    }), cfg.timeout);
    // Non-streaming text can still be cut off by a token/safety limit. Never
    // pass such a partial payload to the browser as successful dialogue.
    const finishReason = response?.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      throw new Error('incomplete-response');
    }
    if (typeof response?.text === 'string' && response.text.trim()) {
      recordCircuitSuccess(model);
      return { text: response.text, cause: null, skipped: false };
    }
    const cause = classifyError(new Error('empty-response'));
    recordCircuitFailure(model, new Error('empty-response'));
    logProviderEvent(PROVIDER_EVENT_BY_CAUSE[cause], model, cause, true);
    return { text: null, cause, skipped: false };
  } catch (error) {
    const cause = classifyError(error);
    recordCircuitFailure(model, error);
    logProviderEvent(PROVIDER_EVENT_BY_CAUSE[cause], model, cause, true);
    return { text: null, cause, skipped: false };
  }
};
const localResult = () => ({ text: '', model_used: LOCAL_FALLBACK, cost_estimate: 0, fallback_used: true });

// Event-shaped core (method, lower-cased headers, raw body). Kept separate
// from the v2 entry point so its behavior stays unit-testable without a
// Request/Response runtime.
const handleEvent = async (event) => {
  const allowedOrigin = getAllowedOrigin(event.headers);
  const headers = headersFor(allowedOrigin);
  if (!allowedOrigin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod === 'GET') {
    return { statusCode: 200, headers, body: JSON.stringify(await capabilities()) };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  const ip = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['x-forwarded-for'] || 'unknown';
  if (!checkRateLimit(ip)) return { statusCode: 429, headers, body: JSON.stringify({ error: 'Rate limit exceeded' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  const rawPrompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!rawPrompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing prompt' }) };
  const requested = body.model || body.provider || PRIMARY_MODEL;
  if (!isGeminiModel(requested) && requested !== DEEPSEEK_AUTO
    && !isDoubaoModel(requested) && !DEEPSEEK_MODELS.includes(requested)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Model not in whitelist' }) };
  }
  const difficulty = body.difficulty === undefined ? 'normal' : body.difficulty;
  if (!Object.hasOwn(DIFFICULTY_PROFILES, difficulty)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid difficulty' }) };
  const prompt = rawPrompt.slice(0, MAX_PROMPT_LEN);
  const tokens = estimateTokens(rawPrompt);
  const responseMimeType = body.responseMimeType === 'application/json' ? 'application/json' : 'text/plain';
  if (requested === DEEPSEEK_AUTO || DEEPSEEK_MODELS.includes(requested)) {
    const profile = DIFFICULTY_PROFILES[difficulty];
    const model = requested === DEEPSEEK_AUTO ? profile.model : requested;
    // UTF-8 bytes bound input tokens conservatively for English and CJK alike.
    // Include the fixed instruction and account for the untruncated input too.
    const inputTokens = Buffer.byteLength(rawPrompt, 'utf8') + 128;
    const cost = estimateCost(model, inputTokens, profile.maxTokens);
    if (process.env.ADAPTER_DRY_RUN === 'true') return { statusCode: 200, headers, body: JSON.stringify({ text: '[dry-run] mock response', model_used: model, reasoning_effort: profile.effort, cost_estimate: cost, fallback_used: false }) };
    const outcome = await tryDeepseek(model, prompt, responseMimeType, profile, cost, inputTokens);
    if (outcome.text) return { statusCode: 200, headers, body: JSON.stringify({ text: outcome.text, model_used: model, reasoning_effort: profile.effort, cost_estimate: outcome.cost, fallback_used: false }) };
    logProviderEvent('provider_fallback', LOCAL_FALLBACK, outcome.cause || 'unavailable', true);
    return { statusCode: 200, headers, body: JSON.stringify(localResult()) };
  }
  if (isDoubaoModel(requested)) {
    const cfg = MODEL_REGISTRY[requested];
    const inputTokens = Buffer.byteLength(rawPrompt, 'utf8') + 128;
    const cost = estimateCost(requested, inputTokens, cfg.maxOutputTokens);
    if (process.env.ADAPTER_DRY_RUN === 'true') return { statusCode: 200, headers, body: JSON.stringify({ text: '[dry-run] mock response', model_used: requested, cost_estimate: cost, fallback_used: false }) };
    const outcome = await tryDoubao(requested, prompt, responseMimeType, cost, inputTokens);
    if (outcome.text) return { statusCode: 200, headers, body: JSON.stringify({ text: outcome.text, model_used: requested, cost_estimate: outcome.cost, fallback_used: false }) };
    logProviderEvent('provider_fallback', LOCAL_FALLBACK, outcome.cause || 'unavailable', true);
    return { statusCode: 200, headers, body: JSON.stringify(localResult()) };
  }
  const chain = requested === SECONDARY_MODEL ? [SECONDARY_MODEL] : [requested, SECONDARY_MODEL];
  if (process.env.ADAPTER_DRY_RUN === 'true') {
    const model = chain[0];
    return { statusCode: 200, headers, body: JSON.stringify({ text: '[dry-run] mock response', model_used: model, cost_estimate: estimateCost(model, tokens), fallback_used: false }) };
  }
  let fallbackCause = 'unavailable';
  for (const model of chain) {
    const cost = estimateCost(model, tokens);
    const outcome = await tryModel(model, prompt, responseMimeType, cost);
    if (outcome.text) return { statusCode: 200, headers, body: JSON.stringify({ text: outcome.text, model_used: model, cost_estimate: cost, fallback_used: model !== requested }) };
    if (!outcome.skipped) fallbackCause = outcome.cause;
  }
  logProviderEvent('provider_fallback', LOCAL_FALLBACK, fallbackCause, true);
  return { statusCode: 200, headers, body: JSON.stringify(localResult()) };
};

// Netlify Functions v2 entry point. AI Gateway credentials (GEMINI_API_KEY,
// GOOGLE_GEMINI_BASE_URL) are injected only into the v2+ runtime. The route
// stays /.netlify/functions/provider-adapter (and its genai-proxy /
// model-adapter aliases, which re-export this module).
const v2Handler = async (req) => {
  const headers = {};
  req.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  const method = String(req.method || 'GET').toUpperCase();
  const body = method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? '' : await req.text();
  const result = await handleEvent({ httpMethod: method, headers, body });
  const status = result.statusCode;
  const hasBody = status !== 204 && result.body !== '';
  return new Response(hasBody ? result.body : null, { status, headers: result.headers });
};

exports.default = v2Handler;
exports.handleEvent = handleEvent;
exports.MODEL_REGISTRY = MODEL_REGISTRY;
exports.PRIMARY_MODEL = PRIMARY_MODEL;
exports.GEMINI_3_8_MODEL = GEMINI_3_8_MODEL;
exports.GEMINI_MODEL_IDS = GEMINI_MODEL_IDS;
exports.SECONDARY_MODEL = SECONDARY_MODEL;
exports.LOCAL_FALLBACK = LOCAL_FALLBACK;
exports.COST_CEILING_PER_CALL = COST_CEILING_PER_CALL;
exports.MAX_PROMPT_LEN = MAX_PROMPT_LEN;
exports.classifyError = classifyError;
exports.DOUBAO_MODEL = DOUBAO_MODEL;
exports.DOUBAO_MODEL_IDS = DOUBAO_MODEL_IDS;
exports.getRequestCounters = () => Object.fromEntries(requestCounters);
exports.getCircuitState = () => Object.fromEntries(circuits);
exports.resetAdapterState = () => {
  capabilityCache = null;
  deepseekCapabilityCache = null;
  doubaoCapabilityCache = null;
  budgetState = { day: '', spent: 0 };
  rateBuckets.clear();
  circuits.clear();
  requestCounters.clear();
};
