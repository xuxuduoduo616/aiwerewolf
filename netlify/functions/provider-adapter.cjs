// Server-only Gemini expression adapter. Rules and action selection never use it.
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
  'local-fallback': Object.freeze({ model: 'local-fallback', timeout: 0, maxRetries: 0 }),
});

const PRIMARY_MODEL = 'gemini-3.6-flash';
const SECONDARY_MODEL = 'gemini-2.5-flash';
const LOCAL_FALLBACK = 'local-fallback';
const MAX_PROMPT_LEN = 6000;
const COST_CEILING_PER_CALL = 0.005;
const DEFAULT_DAILY_BUDGET_USD = 0.05;
const CAPABILITY_CACHE_MS = 60_000;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const CIRCUIT_FAILURE_THRESHOLD = 2;
const CIRCUIT_COOLDOWN_MS = 60_000;
let capabilityCache = null;
let budgetState = { day: '', spent: 0 };
const rateBuckets = new Map();
const circuits = new Map();
const requestCounters = new Map();

const estimateTokens = (text) => Math.ceil(String(text || '').length / 4);
const estimateCost = (model, inputTokens) => {
  const cfg = MODEL_REGISTRY[model];
  if (!cfg || !cfg.inputCostPer1kTokens) return Infinity;
  return (inputTokens / 1000) * cfg.inputCostPer1kTokens
    + (cfg.maxOutputTokens / 1000) * cfg.outputCostPer1kTokens;
};
const dayKey = () => new Date().toISOString().slice(0, 10);
const dailyBudget = () => {
  const value = Number(process.env.ADAPTER_DAILY_BUDGET_USD);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_DAILY_BUDGET_USD;
};
const canSpend = (cost) => {
  const day = dayKey();
  if (budgetState.day !== day) budgetState = { day, spent: 0 };
  return Number.isFinite(cost) && cost <= COST_CEILING_PER_CALL && budgetState.spent + cost <= dailyBudget();
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
  if (error?.message === 'timeout') return 'timeout';
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
const withTimeout = (operation, timeout) => Promise.race([
  operation,
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeout)),
]);

const verifiedCapabilities = async () => {
  const key = getApiKey();
  if (!key) return null;
  if (capabilityCache && Date.now() - capabilityCache.at < CAPABILITY_CACHE_MS) return capabilityCache.value;
  try {
    const client = new GoogleGenAI({ apiKey: key });
    const [primary, secondary] = await Promise.all([
      withTimeout(client.models.get({ model: PRIMARY_MODEL }), 5000),
      withTimeout(client.models.get({ model: SECONDARY_MODEL }), 5000),
    ]);
    if (!modelNameMatches(primary?.name, PRIMARY_MODEL) || !modelNameMatches(secondary?.name, SECONDARY_MODEL)) return null;
    const value = {
      default_model: PRIMARY_MODEL,
      models: [
        { id: PRIMARY_MODEL, label: 'Gemini 3.6 Flash' },
        { id: SECONDARY_MODEL, label: 'Gemini 2.5 Flash' },
      ],
    };
    capabilityCache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
};
const fallbackCapabilities = () => ({
  default_model: SECONDARY_MODEL,
  models: [{ id: SECONDARY_MODEL, label: 'Gemini 2.5 Flash' }],
});

const generationConfig = (model, responseMimeType) => {
  const config = { responseMimeType, maxOutputTokens: MODEL_REGISTRY[model].maxOutputTokens };
  if (model === PRIMARY_MODEL) {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel?.MINIMAL || 'MINIMAL' };
  }
  return config;
};
const tryModel = async (model, prompt, responseMimeType, cost) => {
  const key = getApiKey();
  if (!key || !canSpend(cost) || !circuitAllows(model)) return null;
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
    if (typeof response?.text === 'string' && response.text.trim()) {
      recordCircuitSuccess(model);
      return response.text;
    }
    recordCircuitFailure(model, new Error('empty-response'));
    return null;
  } catch (error) {
    recordCircuitFailure(model, error);
    return null;
  }
};
const localResult = () => ({ text: '', model_used: LOCAL_FALLBACK, cost_estimate: 0, fallback_used: true });

exports.handler = async (event) => {
  const allowedOrigin = getAllowedOrigin(event.headers);
  const headers = headersFor(allowedOrigin);
  if (!allowedOrigin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod === 'GET') {
    const capabilities = await verifiedCapabilities();
    return { statusCode: 200, headers, body: JSON.stringify(capabilities || fallbackCapabilities()) };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  const ip = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['x-forwarded-for'] || 'unknown';
  if (!checkRateLimit(ip)) return { statusCode: 429, headers, body: JSON.stringify({ error: 'Rate limit exceeded' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const rawPrompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!rawPrompt) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing prompt' }) };
  const requested = body.model || body.provider || PRIMARY_MODEL;
  if (requested !== PRIMARY_MODEL && requested !== SECONDARY_MODEL) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Model not in whitelist' }) };
  }
  const prompt = rawPrompt.slice(0, MAX_PROMPT_LEN);
  const tokens = estimateTokens(rawPrompt);
  const responseMimeType = body.responseMimeType === 'application/json' ? 'application/json' : 'text/plain';
  const chain = requested === SECONDARY_MODEL ? [SECONDARY_MODEL] : [PRIMARY_MODEL, SECONDARY_MODEL];
  if (process.env.ADAPTER_DRY_RUN === 'true') {
    const model = chain[0];
    return { statusCode: 200, headers, body: JSON.stringify({ text: '[dry-run] mock response', model_used: model, cost_estimate: estimateCost(model, tokens), fallback_used: false }) };
  }
  for (const model of chain) {
    const cost = estimateCost(model, tokens);
    const text = await tryModel(model, prompt, responseMimeType, cost);
    if (text) return { statusCode: 200, headers, body: JSON.stringify({ text, model_used: model, cost_estimate: cost, fallback_used: model !== requested }) };
  }
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
  budgetState = { day: '', spent: 0 };
  rateBuckets.clear();
  circuits.clear();
  requestCounters.clear();
};
