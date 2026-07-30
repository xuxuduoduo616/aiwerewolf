// --- START OF FILE netlify/functions/provider-adapter.js ---
//
// Protocol-aware provider adapter: unified server-side routing across Gemini
// (SDK), Anthropic-Messages, OpenAI-Chat, and OpenAI Responses protocol
// providers, with a
// circuit breaker, error classification, cost guard, dry-run mode, log
// redaction, and a deterministic fallback chain that ends in the
// local-fallback signal (the frontend then uses its speech library).
//
// This file extends the pattern of model-adapter.js (which stays Gemini-only
// and untouched). This layer only shapes expression; it never decides game
// actions — rules stay in gameEngine/beliefTracker/actionSelector.
//
// No API keys live in this source. Keys are read from process.env only when a
// live call is made. For tests and offline work, set ADAPTER_DRY_RUN=true to
// get a deterministic mock response without any network call.

// Provider registry. Providers without a verified protocol contract are
// intentionally not listed. Costs are conservative per-1k-token estimates
// used only for the local cost guard, not billing truth. GPT routes use the
// most expensive verified Gateway provider price so dynamic routing cannot
// make the local estimate lower than the possible upstream charge.
const PROVIDER_REGISTRY = {
  // Gemini via the official @google/genai SDK (same route as model-adapter.js).
  'gemini-2.5-flash': {
    baseUrl: null, // SDK manages the endpoint.
    protocol: 'gemini',
    model: 'gemini-2.5-flash',
    authHeader: 'sdk',
    apiKeyEnv: ['API_KEY', 'GEMINI_API_KEY'],
    timeout: 15000,
    maxRetries: 2,
    costPer1kTokens: 0.00015,
    capabilities: ['text', 'json'],
  },
  // AICodeMirror Claude proxy — Anthropic Messages protocol. Accepts x-api-key
  // or Authorization: Bearer; errors are proxy-wrapped {"error": "string"}, so
  // we classify by HTTP status, never by body shape.
  'aicodemirror-claude': {
    baseUrl: 'https://api.aicodemirror.com/api/claudecode',
    protocol: 'anthropic-messages',
    model: 'claude-sonnet-4-6',
    authHeader: 'x-api-key',
    apiKeyEnv: ['AICODEMIRROR_API_KEY'],
    timeout: 20000,
    maxRetries: 1,
    costPer1kTokens: 0.003,
    capabilities: ['text'],
  },
  // DeepSeek official Anthropic-compatible endpoint (x-api-key auth).
  'deepseek-anthropic': {
    baseUrl: 'https://api.deepseek.com/anthropic',
    protocol: 'anthropic-messages',
    model: 'deepseek-chat',
    authHeader: 'x-api-key',
    apiKeyEnv: ['DEEPSEEK_API_KEY'],
    timeout: 20000,
    maxRetries: 1,
    costPer1kTokens: 0.00027,
    capabilities: ['text'],
  },
  // DeepSeek OpenAI-compatible chat endpoint (same key, Bearer auth).
  'deepseek-openai': {
    baseUrl: 'https://api.deepseek.com/v1',
    protocol: 'openai-chat',
    model: 'deepseek-chat',
    authHeader: 'authorization-bearer',
    apiKeyEnv: ['DEEPSEEK_API_KEY'],
    timeout: 20000,
    maxRetries: 1,
    costPer1kTokens: 0.00027,
    capabilities: ['text'],
  },
  // Direct OpenAI Responses routes. These are explicit opt-in providers only:
  // neither appears in DEFAULT_CHAIN. OPENAI_API_KEY is read server-side.
  'gpt-5.5': {
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'openai-responses',
    model: 'gpt-5.5',
    authHeader: 'authorization-bearer',
    apiKeyEnv: ['OPENAI_API_KEY'],
    timeout: 15000,
    maxRetries: 0,
    inputCostPer1kTokens: 0.0055,
    outputCostPer1kTokens: 0.033,
    maxOutputTokens: 128,
    costCeilingPerCall: 0.016,
    capabilities: ['text', 'reasoning-low'],
  },
  'gpt-5.6-luna': {
    baseUrl: 'https://api.openai.com/v1',
    protocol: 'openai-responses',
    model: 'gpt-5.6-luna',
    authHeader: 'authorization-bearer',
    apiKeyEnv: ['OPENAI_API_KEY'],
    timeout: 15000,
    maxRetries: 0,
    inputCostPer1kTokens: 0.0011,
    outputCostPer1kTokens: 0.0066,
    maxOutputTokens: 128,
    costCeilingPerCall: 0.005,
    capabilities: ['text', 'reasoning-low'],
  },
  // Local fallback — 0 cost, never calls out.
  'local-fallback': {
    baseUrl: null,
    protocol: 'local',
    model: 'local-fallback',
    authHeader: 'none',
    apiKeyEnv: [],
    timeout: 500,
    maxRetries: 0,
    costPer1kTokens: 0,
    capabilities: ['text'],
  },
};

// Deterministic fallback order for live providers; the chain always ends in
// the local-fallback signal returned by the handler.
const DEFAULT_CHAIN = [
  'gemini-2.5-flash',
  'aicodemirror-claude',
  'deepseek-anthropic',
  'deepseek-openai',
];
const LOCAL_FALLBACK = 'local-fallback';
const COST_CEILING_PER_CALL = 0.005; // $0.005 max per call.
const MAX_PROMPT_LEN = 8000;
const ANTHROPIC_MAX_TOKENS = 1024;
const OPENAI_MODEL_IDS = Object.freeze(['gpt-5.5', 'gpt-5.6-luna']);
const OPENAI_GATEWAY_SLUGS = Object.freeze({
  'gpt-5.5': 'openai/gpt-5.5',
  'gpt-5.6-luna': 'openai/gpt-5.6-luna',
});
const OPENAI_UPSTREAMS = Object.freeze({
  direct: Object.freeze({
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  }),
  gateway: Object.freeze({
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    apiKeyEnv: 'AI_GATEWAY_API_KEY',
  }),
});
const CAPABILITIES_CACHE_TTL_MS = 60_000;
const CAPABILITIES_TIMEOUT_MS = 5_000;
const openAIUpstreamSelection = { name: '', verifiedUntil: 0 };

const cachePreferredOpenAIUpstream = (name, now = Date.now()) => {
  if (!OPENAI_UPSTREAMS[name]) return;
  openAIUpstreamSelection.name = name;
  openAIUpstreamSelection.verifiedUntil = now + CAPABILITIES_CACHE_TTL_MS;
};

const getSelectedOpenAIUpstream = (now = Date.now()) => {
  const preferred =
    openAIUpstreamSelection.verifiedUntil > now && OPENAI_UPSTREAMS[openAIUpstreamSelection.name]
      ? openAIUpstreamSelection.name
      : '';
  if (preferred) return preferred;
  return process.env.AI_GATEWAY_API_KEY ? 'gateway' : 'direct';
};

// Backwards-compatible test hook. The array intentionally contains exactly
// one upstream: a user request may issue at most one GPT generation POST.
const getOpenAIUpstreamOrder = (now = Date.now()) => [getSelectedOpenAIUpstream(now)];

// Rough token estimate: ~4 chars per token (same heuristic as model-adapter.js).
const estimateTokens = (text) => Math.ceil((text || '').length / 4);

const estimateCost = (provider, tokens) => {
  const cfg = PROVIDER_REGISTRY[provider];
  if (!cfg) return Infinity;
  if (typeof cfg.inputCostPer1kTokens === 'number') {
    const inputCost = (tokens / 1000) * cfg.inputCostPer1kTokens;
    const outputCost = ((cfg.maxOutputTokens || 0) / 1000) * cfg.outputCostPer1kTokens;
    return inputCost + outputCost;
  }
  return (tokens / 1000) * cfg.costPer1kTokens;
};

const getCostCeiling = (provider) => {
  const cfg = PROVIDER_REGISTRY[provider];
  return cfg && typeof cfg.costCeilingPerCall === 'number'
    ? cfg.costCeilingPerCall
    : COST_CEILING_PER_CALL;
};

const getAllowedOrigin = (requestOrigin) => {
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return requestOrigin || '*';
  return allowed.includes(requestOrigin) ? requestOrigin : allowed[0];
};

// --- Log redaction -----------------------------------------------------------
// No log line may ever contain key material or Authorization / x-api-key header
// values. Every log in this module goes through logError, which redacts first.

const BEARER_RE = /Bearer\s+[^\s'",;]+/gi;
const SENSITIVE_HEADER_RE = /((?:authorization|x-api-key)['"]?\s*[:=]\s*)['"]?[^\s'",;]+/gi;

const collectSecrets = () => {
  const secrets = [];
  for (const cfg of Object.values(PROVIDER_REGISTRY)) {
    for (const envName of cfg.apiKeyEnv || []) {
      const value = process.env[envName];
      if (value && !secrets.includes(value)) secrets.push(value);
    }
  }
  for (const upstream of Object.values(OPENAI_UPSTREAMS)) {
    const value = process.env[upstream.apiKeyEnv];
    if (value && !secrets.includes(value)) secrets.push(value);
  }
  return secrets;
};

const redactForLog = (value) => {
  let text;
  if (typeof value === 'string') text = value;
  else if (value && typeof value.message === 'string') text = value.message;
  else text = String(value);
  for (const secret of collectSecrets()) {
    text = text.split(secret).join('[REDACTED]');
  }
  text = text.replace(BEARER_RE, 'Bearer [REDACTED]');
  text = text.replace(SENSITIVE_HEADER_RE, '$1[REDACTED]');
  return text;
};

const logError = (...parts) => {
  console.error(...parts.map(redactForLog));
};

// --- Error classification ----------------------------------------------------
// Every failure is classified as auth | timeout | rate-limit | server | network.

const classifyError = (err) => {
  const status = err && err.status;
  const message = (err && err.message) || '';
  if (status === 401 || status === 403 || message === 'missing-api-key') return 'auth';
  if (status === 429) return 'rate-limit';
  if (typeof status === 'number' && status >= 500) return 'server';
  if (message === 'timeout') return 'timeout';
  return 'network';
};

// --- Circuit breaker ---------------------------------------------------------
// After BREAKER_THRESHOLD consecutive failures a provider is skipped until its
// cooldown expires, then attempts resume (a further failure re-opens it, a
// success resets it). LIMITATION: state is module-level, i.e. per warm Lambda
// instance only — a cold start resets it and parallel instances do not share
// it. That is acceptable: the breaker is a best-effort latency guard, not a
// correctness mechanism.

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;
const breakerState = new Map();

const getBreaker = (provider) => {
  if (!breakerState.has(provider)) {
    breakerState.set(provider, { consecutiveFailures: 0, openUntil: 0 });
  }
  return breakerState.get(provider);
};

const recordProviderFailure = (provider, now = Date.now()) => {
  const state = getBreaker(provider);
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= BREAKER_THRESHOLD) {
    state.openUntil = now + BREAKER_COOLDOWN_MS;
  }
};

const recordProviderSuccess = (provider) => {
  const state = getBreaker(provider);
  state.consecutiveFailures = 0;
  state.openUntil = 0;
};

const isProviderOpen = (provider, now = Date.now()) => getBreaker(provider).openUntil > now;

const resetProviderState = () => breakerState.clear();

// --- Daily budget accumulator --------------------------------------------------
// Cumulative estimated spend layered on top of the per-call cost ceiling. The
// ceiling is env-configurable via ADAPTER_DAILY_BUDGET_USD (conservative $1/day
// default) and the accumulator resets when the UTC date changes. LIMITATION:
// like the circuit breaker and rate limiter, this state is module-level, i.e.
// per warm Lambda instance only — cold starts reset it and parallel instances
// do not share it. It is a per-instance soft guard, not global billing truth.

const DEFAULT_DAILY_BUDGET_USD = 1.0;

const getDailyBudgetUsd = () => {
  const configured = Number(process.env.ADAPTER_DAILY_BUDGET_USD);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_DAILY_BUDGET_USD;
};

const utcDateOf = (now) => new Date(now).toISOString().slice(0, 10);

const budgetState = { utcDate: utcDateOf(Date.now()), spentUsd: 0 };

// Request counts per provider/model since instance start, keyed "provider:model".
const requestCounters = new Map();

const rollBudgetDay = (now) => {
  const today = utcDateOf(now);
  if (budgetState.utcDate !== today) {
    budgetState.utcDate = today;
    budgetState.spentUsd = 0;
  }
};

const getBudgetRemaining = (now = Date.now()) => {
  rollBudgetDay(now);
  return Math.max(0, getDailyBudgetUsd() - budgetState.spentUsd);
};

const recordBudgetSpend = (usd, now = Date.now()) => {
  rollBudgetDay(now);
  budgetState.spentUsd += usd;
};

const countRequest = (provider) => {
  const cfg = PROVIDER_REGISTRY[provider];
  const key = `${provider}:${(cfg && cfg.model) || provider}`;
  requestCounters.set(key, (requestCounters.get(key) || 0) + 1);
};

const getRequestCounters = () => Object.fromEntries(requestCounters);

const resetBudgetState = (now = Date.now()) => {
  budgetState.utcDate = utcDateOf(now);
  budgetState.spentUsd = 0;
  requestCounters.clear();
};

// --- Protocol translators ----------------------------------------------------

const resolveApiKey = (cfg) => {
  for (const envName of cfg.apiKeyEnv || []) {
    const value = process.env[envName];
    if (value) return value;
  }
  return '';
};

const buildAuthHeaders = (cfg, apiKey) => {
  if (cfg.authHeader === 'x-api-key') return { 'x-api-key': apiKey };
  if (cfg.authHeader === 'authorization-bearer') return { Authorization: `Bearer ${apiKey}` };
  return {};
};

// fetch with a hard timeout; non-2xx becomes an Error carrying .status.
const fetchJsonWithTimeout = async (url, init, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const httpErr = new Error(`http-${res.status}`);
    httpErr.status = res.status;
    throw httpErr;
  }
  return res.json();
};

// Gemini via the @google/genai SDK (same call shape as model-adapter.js).
const callGemini = async (cfg, apiKey, prompt, options) => {
  const { GoogleGenAI } = require('@google/genai');
  const client = new GoogleGenAI({ apiKey });
  let timer;
  const timeoutGate = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), cfg.timeout);
  });
  try {
    return await Promise.race([
      client.models
        .generateContent({
          model: cfg.model,
          contents: prompt,
          config: {
            responseMimeType: options.responseMimeType,
            temperature: options.temperature,
          },
        })
        .then((res) => res.text),
      timeoutGate,
    ]);
  } finally {
    clearTimeout(timer);
  }
};

// Anthropic Messages protocol: POST {baseUrl}/v1/messages, text in content[0].text.
const callAnthropicMessages = async (cfg, apiKey, prompt, options) => {
  const data = await fetchJsonWithTimeout(
    `${cfg.baseUrl}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...buildAuthHeaders(cfg, apiKey),
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        temperature: options.temperature,
        messages: [{ role: 'user', content: prompt }],
      }),
    },
    cfg.timeout
  );
  const block = data && Array.isArray(data.content) ? data.content[0] : null;
  return block && typeof block.text === 'string' ? block.text : '';
};

// OpenAI Chat protocol: POST {baseUrl}/chat/completions, text in choices[0].message.content.
const callOpenAIChat = async (cfg, apiKey, prompt, options) => {
  const data = await fetchJsonWithTimeout(
    `${cfg.baseUrl}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(cfg, apiKey),
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: options.temperature,
        messages: [{ role: 'user', content: prompt }],
      }),
    },
    cfg.timeout
  );
  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  const text = choice && choice.message && choice.message.content;
  return typeof text === 'string' ? text : '';
};

const extractOpenAIResponsesText = (data) => {
  if (typeof data.output_text === 'string') return data.output_text;
  if (!Array.isArray(data.output)) return '';
  const texts = [];
  for (const item of data.output) {
    if (!item || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content && content.type === 'output_text' && typeof content.text === 'string') {
        texts.push(content.text);
      }
    }
  }
  return texts.join('');
};

// OpenAI-compatible Responses protocol: POST /v1/responses. The product model
// ID remains gpt-5.x; only Vercel Gateway's upstream request uses creator/model.
const callOpenAIResponsesUpstream = async (cfg, upstreamName, apiKey, prompt) => {
  const upstream = OPENAI_UPSTREAMS[upstreamName];
  const upstreamModel =
    upstreamName === 'gateway' ? OPENAI_GATEWAY_SLUGS[cfg.model] : cfg.model;
  const data = await fetchJsonWithTimeout(
    `${upstream.baseUrl}/responses`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildAuthHeaders(cfg, apiKey),
      },
      body: JSON.stringify({
        model: upstreamModel,
        input: prompt,
        reasoning: { effort: 'low' },
        max_output_tokens: cfg.maxOutputTokens,
      }),
    },
    cfg.timeout
  );
  return extractOpenAIResponsesText(data);
};

// A selected product model may use either direct OpenAI or Vercel AI Gateway.
// Capability discovery selects one upstream for the warm instance. Without a
// verified selection, the presence of AI_GATEWAY_API_KEY selects Gateway;
// otherwise direct OpenAI is selected. We never try the other GPT upstream in
// the same user request: failure proceeds to the existing Gemini/local chain.
// A later read-only capability refresh may select a different upstream.
const callOpenAIResponses = async (cfg, prompt) => {
  const upstreamName = getSelectedOpenAIUpstream(Date.now());
  const upstream = OPENAI_UPSTREAMS[upstreamName];
  const apiKey = process.env[upstream.apiKeyEnv] || '';
  if (!apiKey) throw new Error('missing-api-key');
  return callOpenAIResponsesUpstream(cfg, upstreamName, apiKey, prompt);
};

// Attempt a single live provider call. Returns text or throws.
const callProvider = async (provider, prompt, options) => {
  const cfg = PROVIDER_REGISTRY[provider];
  if (cfg.protocol === 'openai-responses') return callOpenAIResponses(cfg, prompt);
  const apiKey = resolveApiKey(cfg);
  if (!apiKey) throw new Error('missing-api-key');
  if (cfg.protocol === 'gemini') return callGemini(cfg, apiKey, prompt, options);
  if (cfg.protocol === 'anthropic-messages') return callAnthropicMessages(cfg, apiKey, prompt, options);
  if (cfg.protocol === 'openai-chat') return callOpenAIChat(cfg, apiKey, prompt, options);
  throw new Error(`unknown-protocol:${cfg.protocol}`);
};

// Try a provider with retries. Auth failures are never retried. Returns text
// or null on exhaustion.
const tryProviderWithRetries = async (provider, prompt, options) => {
  const cfg = PROVIDER_REGISTRY[provider];
  if (!cfg || cfg.protocol === 'local') return null;
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const text = await callProvider(provider, prompt, options);
      if (typeof text === 'string' && text.trim().length > 0) return text;
      throw new Error('empty-response');
    } catch (err) {
      const kind = classifyError(err);
      logError(`provider-adapter ${provider} attempt ${attempt} failed (${kind}): ${(err && err.message) || err}`);
      if (kind === 'auth') break;
    }
  }
  return null;
};

// --- Read-only capability discovery -----------------------------------------
// GPT availability is atomic per upstream: direct OpenAI must return both exact
// product IDs, or Gateway's read-only model list must contain both exact
// creator/model slugs, before either product model is exposed. A successful
// upstream selection is cached briefly per warm Lambda instance. The browser
// response never contains upstream identity, auth diagnostics, or bodies.

const capabilitiesCache = { verifiedUntil: 0 };

const resetCapabilitiesCache = () => {
  capabilitiesCache.verifiedUntil = 0;
  openAIUpstreamSelection.name = '';
  openAIUpstreamSelection.verifiedUntil = 0;
};

const probeExactDirectOpenAIModel = async (model, apiKey) => {
  const cfg = PROVIDER_REGISTRY[model];
  try {
    const data = await fetchJsonWithTimeout(
      `${cfg.baseUrl}/models/${encodeURIComponent(model)}`,
      {
        method: 'GET',
        headers: buildAuthHeaders(cfg, apiKey),
      },
      CAPABILITIES_TIMEOUT_MS
    );
    return Boolean(data && data.id === model);
  } catch (err) {
    logError(`provider-adapter capability check ${model} upstream direct failed (${classifyError(err)})`);
    return false;
  }
};

const probeDirectOpenAIModels = async (apiKey) => {
  if (!apiKey) return false;
  const access = await Promise.all(
    OPENAI_MODEL_IDS.map((model) => probeExactDirectOpenAIModel(model, apiKey))
  );
  return access.every(Boolean);
};

const probeGatewayOpenAIModels = async (apiKey) => {
  if (!apiKey) return false;
  try {
    const data = await fetchJsonWithTimeout(
      `${OPENAI_UPSTREAMS.gateway.baseUrl}/models`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      CAPABILITIES_TIMEOUT_MS
    );
    const ids = new Set(
      data && Array.isArray(data.data)
        ? data.data.map((entry) => entry && entry.id).filter((id) => typeof id === 'string')
        : []
    );
    return OPENAI_MODEL_IDS.every((model) => ids.has(OPENAI_GATEWAY_SLUGS[model]));
  } catch (err) {
    logError(`provider-adapter capability check upstream gateway failed (${classifyError(err)})`);
    return false;
  }
};

const getProviderCapabilities = async (now = Date.now()) => {
  const base = {
    default_model: 'gemini-2.5-flash',
    models: [{ id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }],
  };
  if (capabilitiesCache.verifiedUntil > now) {
    return {
      ...base,
      models: [
        ...base.models,
        { id: 'gpt-5.5', label: 'GPT-5.5' },
        { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
      ],
    };
  }

  const directKey = process.env.OPENAI_API_KEY || '';
  const gatewayKey = process.env.AI_GATEWAY_API_KEY || '';
  if (!directKey && !gatewayKey) return base;
  const [gatewayAccess, directAccess] = await Promise.all([
    probeGatewayOpenAIModels(gatewayKey),
    probeDirectOpenAIModels(directKey),
  ]);
  const selectedUpstream = gatewayAccess ? 'gateway' : directAccess ? 'direct' : '';
  if (!selectedUpstream) return base;
  capabilitiesCache.verifiedUntil = now + CAPABILITIES_CACHE_TTL_MS;
  cachePreferredOpenAIUpstream(selectedUpstream, now);
  return {
    ...base,
    models: [
      ...base.models,
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    ],
  };
};

exports.handler = async function (event) {
  const eventHeaders = event.headers || {};
  const requestOrigin = eventHeaders.origin || eventHeaders.Origin || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': getAllowedOrigin(requestOrigin),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: { ...headers, 'Cache-Control': 'no-store' },
      body: JSON.stringify(await getProviderCapabilities(Date.now())),
    };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const rawPrompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!rawPrompt) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing prompt' }) };
  }

  // Route: honor a whitelisted requested provider, else the default chain.
  const requested = body.provider;
  if (requested && !PROVIDER_REGISTRY[requested]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Provider not in registry' }) };
  }

  let chain;
  if (requested === LOCAL_FALLBACK) chain = [];
  else if (requested) chain = [requested, ...DEFAULT_CHAIN.filter((name) => name !== requested)];
  else chain = [...DEFAULT_CHAIN];
  const primary = chain[0] || LOCAL_FALLBACK;

  // Estimate the primary route for dry-run metadata. Live cost and budget
  // admission is checked independently for every provider immediately before
  // its attempt, including fallbacks.
  const tokens = estimateTokens(rawPrompt);
  const cost = estimateCost(primary, tokens);
  const budgetRemaining = getBudgetRemaining(Date.now());

  // Truncate to a safe max before any live call. Admission remains based on the
  // original requested size so truncation cannot make an oversized request
  // appear cheaper.
  const prompt = rawPrompt.length > MAX_PROMPT_LEN ? rawPrompt.slice(0, MAX_PROMPT_LEN) : rawPrompt;

  const options = {
    responseMimeType: body.responseMimeType === 'application/json' ? 'application/json' : 'text/plain',
    temperature: typeof body.temperature === 'number' ? Math.max(0, Math.min(2, body.temperature)) : 0.7,
  };

  // Dry-run mode: deterministic mock, no network, mock-safe for tests.
  if (process.env.ADAPTER_DRY_RUN === 'true') {
    countRequest(primary);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        text: '[dry-run] mock response',
        model_used: primary,
        cost_estimate: cost,
        fallback_used: false,
        budget_remaining: budgetRemaining,
      }),
    };
  }

  // Deterministic fallback chain; open circuit breakers are skipped.
  for (const provider of chain) {
    if (isProviderOpen(provider, Date.now())) {
      logError(`provider-adapter ${provider} skipped: circuit open`);
      continue;
    }
    const callCost = estimateCost(provider, tokens);
    if (callCost > getCostCeiling(provider)) {
      logError(`provider-adapter ${provider} skipped: per-call cost ceiling`);
      continue;
    }
    if (callCost > getBudgetRemaining(Date.now())) {
      logError(`provider-adapter ${provider} skipped: daily budget remaining`);
      continue;
    }
    countRequest(provider);
    const text = await tryProviderWithRetries(provider, prompt, options);
    if (text) {
      recordProviderSuccess(provider);
      recordBudgetSpend(callCost, Date.now());
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          text,
          model_used: provider,
          cost_estimate: callCost,
          fallback_used: provider !== primary,
          budget_remaining: getBudgetRemaining(Date.now()),
        }),
      };
    }
    recordProviderFailure(provider, Date.now());
  }

  // All live providers failed — signal the caller to use its local speech library.
  countRequest(LOCAL_FALLBACK);
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      text: '',
      model_used: LOCAL_FALLBACK,
      cost_estimate: 0,
      fallback_used: true,
      budget_remaining: getBudgetRemaining(Date.now()),
    }),
  };
};

// Exported for unit tests.
exports.PROVIDER_REGISTRY = PROVIDER_REGISTRY;
exports.DEFAULT_CHAIN = DEFAULT_CHAIN;
exports.OPENAI_MODEL_IDS = OPENAI_MODEL_IDS;
exports.OPENAI_GATEWAY_SLUGS = OPENAI_GATEWAY_SLUGS;
exports.OPENAI_UPSTREAMS = OPENAI_UPSTREAMS;
exports.COST_CEILING_PER_CALL = COST_CEILING_PER_CALL;
exports.getCostCeiling = getCostCeiling;
exports.CAPABILITIES_CACHE_TTL_MS = CAPABILITIES_CACHE_TTL_MS;
exports.BREAKER_THRESHOLD = BREAKER_THRESHOLD;
exports.BREAKER_COOLDOWN_MS = BREAKER_COOLDOWN_MS;
exports.classifyError = classifyError;
exports.redactForLog = redactForLog;
exports.recordProviderFailure = recordProviderFailure;
exports.recordProviderSuccess = recordProviderSuccess;
exports.isProviderOpen = isProviderOpen;
exports.resetProviderState = resetProviderState;
exports.DEFAULT_DAILY_BUDGET_USD = DEFAULT_DAILY_BUDGET_USD;
exports.getBudgetRemaining = getBudgetRemaining;
exports.recordBudgetSpend = recordBudgetSpend;
exports.getRequestCounters = getRequestCounters;
exports.resetBudgetState = resetBudgetState;
exports.getProviderCapabilities = getProviderCapabilities;
exports.resetCapabilitiesCache = resetCapabilitiesCache;
exports.getSelectedOpenAIUpstream = getSelectedOpenAIUpstream;
exports.getOpenAIUpstreamOrder = getOpenAIUpstreamOrder;

// --- END OF FILE netlify/functions/provider-adapter.js ---
