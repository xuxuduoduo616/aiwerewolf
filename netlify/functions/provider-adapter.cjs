// Server-only expression adapter. Rules and action selection never use it.
const { GoogleGenAI, ThinkingLevel } = require('@google/genai');

const MODEL_REGISTRY = Object.freeze({
  'gemini-3.6-flash': Object.freeze({
    model: 'gemini-3.6-flash',
    inputCostPer1kTokens: 0.0015,
    outputCostPer1kTokens: 0.0075,
    maxOutputTokens: 256,
    timeout: 12000,
    maxRetries: 0,
  }),
  'gemini-2.5-flash': Object.freeze({
    model: 'gemini-2.5-flash',
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
  'local-fallback': Object.freeze({ model: 'local-fallback', timeout: 0, maxRetries: 0 }),
});

const PRIMARY_MODEL = 'gemini-3.6-flash';
const SECONDARY_MODEL = 'gemini-2.5-flash';
const LOCAL_FALLBACK = 'local-fallback';
const DEEPSEEK_AUTO = 'deepseek-auto';
const DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
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

const verifiedCapabilities = async () => {
  const key = getApiKey();
  if (!key) return null;
  if (capabilityCache && Date.now() - capabilityCache.at < CAPABILITY_CACHE_MS) return capabilityCache.value;
  try {
    const client = new GoogleGenAI({ apiKey: key });
    const results = await Promise.allSettled([PRIMARY_MODEL, SECONDARY_MODEL].map(model =>
      withTimeout(client.models.get({ model }), 5000)));
    const verified = [PRIMARY_MODEL, SECONDARY_MODEL].filter((id, index) =>
      results[index].status === 'fulfilled' && modelNameMatches(results[index].value?.name, id));
    const value = {
      default_model: verified.includes(PRIMARY_MODEL) ? PRIMARY_MODEL : SECONDARY_MODEL,
      models: [
        ...(verified.includes(PRIMARY_MODEL) ? [{ id: PRIMARY_MODEL, label: 'Gemini 3.6 Flash' }] : []),
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

const capabilities = async () => {
  const [gemini, deepseek] = await Promise.all([verifiedCapabilities(), verifiedDeepseekModels()]);
  const base = gemini || fallbackCapabilities();
  if (!deepseek.length) return base;
  return {
    default_model: deepseek.length === DEEPSEEK_MODELS.length ? DEEPSEEK_AUTO : deepseek[0],
    verified_models: [...deepseek, ...base.verified_models],
    models: [
      ...(deepseek.length === DEEPSEEK_MODELS.length ? [{ id: DEEPSEEK_AUTO, label: 'Automatic · DeepSeek by difficulty' }] : []),
      ...deepseek.map(id => ({ id, label: id === 'deepseek-flash' ? 'DeepSeek V4.1 Flash' : 'DeepSeek V4 Pro' })),
      ...base.models,
    ],
  };
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
    const usage = response?.usage;
    let charged = cost;
    if (Number.isInteger(usage?.prompt_tokens) && usage.prompt_tokens >= 0 && usage.prompt_tokens <= inputTokens
      && Number.isInteger(usage?.completion_tokens) && usage.completion_tokens >= 0 && usage.completion_tokens <= profile.maxTokens) {
      charged = estimateCost(model, usage.prompt_tokens, usage.completion_tokens);
      if (budgetState.day === reservationDay) budgetState.spent = Math.max(0, budgetState.spent - cost + charged);
    }
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
  if (model === PRIMARY_MODEL) {
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

exports.handler = async (event) => {
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
  if (requested !== PRIMARY_MODEL && requested !== SECONDARY_MODEL && requested !== DEEPSEEK_AUTO && !DEEPSEEK_MODELS.includes(requested)) {
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
  const chain = requested === SECONDARY_MODEL ? [SECONDARY_MODEL] : [PRIMARY_MODEL, SECONDARY_MODEL];
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

exports.MODEL_REGISTRY = MODEL_REGISTRY;
exports.PRIMARY_MODEL = PRIMARY_MODEL;
exports.SECONDARY_MODEL = SECONDARY_MODEL;
exports.LOCAL_FALLBACK = LOCAL_FALLBACK;
exports.COST_CEILING_PER_CALL = COST_CEILING_PER_CALL;
exports.MAX_PROMPT_LEN = MAX_PROMPT_LEN;
exports.classifyError = classifyError;
exports.getRequestCounters = () => Object.fromEntries(requestCounters);
exports.getCircuitState = () => Object.fromEntries(circuits);
exports.resetAdapterState = () => {
  capabilityCache = null;
  deepseekCapabilityCache = null;
  budgetState = { day: '', spent: 0 };
  rateBuckets.clear();
  circuits.clear();
  requestCounters.clear();
};
