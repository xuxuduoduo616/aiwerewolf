// --- START OF FILE netlify/functions/provider-adapter.js ---
//
// Protocol-aware provider adapter: unified server-side routing across Gemini
// (SDK), Anthropic-Messages, and OpenAI-Chat protocol providers, with a
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

// Provider registry. Protocol facts verified in
// memory/coordination/reports/provider-discovery-initial.md — vibecoder.store
// was unreachable and is intentionally NOT listed. Costs are approximate
// per-1k-token figures used only for the local cost guard, not billing truth.
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
  // aicodemirror Claude proxy — Anthropic Messages protocol. Accepts x-api-key
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

// Rough token estimate: ~4 chars per token (same heuristic as model-adapter.js).
const estimateTokens = (text) => Math.ceil((text || '').length / 4);

const estimateCost = (provider, tokens) => {
  const cfg = PROVIDER_REGISTRY[provider];
  if (!cfg) return Infinity;
  return (tokens / 1000) * cfg.costPer1kTokens;
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

// Attempt a single live provider call. Returns text or throws.
const callProvider = async (provider, prompt, options) => {
  const cfg = PROVIDER_REGISTRY[provider];
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
      if (typeof text === 'string' && text.length > 0) return text;
      throw new Error('empty-response');
    } catch (err) {
      const kind = classifyError(err);
      logError(`provider-adapter ${provider} attempt ${attempt} failed (${kind}): ${(err && err.message) || err}`);
      if (kind === 'auth') break;
    }
  }
  return null;
};

exports.handler = async function (event) {
  const requestOrigin = event.headers.origin || event.headers.Origin || '';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': getAllowedOrigin(requestOrigin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
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

  // Cost guard against the primary route, based on the *requested* input size
  // (before truncation) so an oversized/expensive request is rejected rather
  // than silently trimmed.
  const tokens = estimateTokens(rawPrompt);
  const cost = estimateCost(primary, tokens);
  if (cost > COST_CEILING_PER_CALL) {
    return {
      statusCode: 402,
      headers,
      body: JSON.stringify({ error: 'Estimated cost exceeds per-call ceiling', cost_estimate: cost }),
    };
  }

  // Passed the cost guard; truncate to a safe max before any live call.
  const prompt = rawPrompt.length > MAX_PROMPT_LEN ? rawPrompt.slice(0, MAX_PROMPT_LEN) : rawPrompt;

  const options = {
    responseMimeType: body.responseMimeType === 'application/json' ? 'application/json' : 'text/plain',
    temperature: typeof body.temperature === 'number' ? Math.max(0, Math.min(2, body.temperature)) : 0.7,
  };

  // Dry-run mode: deterministic mock, no network, mock-safe for tests.
  if (process.env.ADAPTER_DRY_RUN === 'true') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        text: '[dry-run] mock response',
        model_used: primary,
        cost_estimate: cost,
        fallback_used: false,
      }),
    };
  }

  // Deterministic fallback chain; open circuit breakers are skipped.
  for (const provider of chain) {
    if (isProviderOpen(provider, Date.now())) {
      logError(`provider-adapter ${provider} skipped: circuit open`);
      continue;
    }
    const text = await tryProviderWithRetries(provider, prompt, options);
    if (text) {
      recordProviderSuccess(provider);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          text,
          model_used: provider,
          cost_estimate: estimateCost(provider, tokens),
          fallback_used: provider !== primary,
        }),
      };
    }
    recordProviderFailure(provider, Date.now());
  }

  // All live providers failed — signal the caller to use its local speech library.
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      text: '',
      model_used: LOCAL_FALLBACK,
      cost_estimate: 0,
      fallback_used: true,
    }),
  };
};

// Exported for unit tests.
exports.PROVIDER_REGISTRY = PROVIDER_REGISTRY;
exports.DEFAULT_CHAIN = DEFAULT_CHAIN;
exports.COST_CEILING_PER_CALL = COST_CEILING_PER_CALL;
exports.BREAKER_THRESHOLD = BREAKER_THRESHOLD;
exports.BREAKER_COOLDOWN_MS = BREAKER_COOLDOWN_MS;
exports.classifyError = classifyError;
exports.redactForLog = redactForLog;
exports.recordProviderFailure = recordProviderFailure;
exports.recordProviderSuccess = recordProviderSuccess;
exports.isProviderOpen = isProviderOpen;
exports.resetProviderState = resetProviderState;

// --- END OF FILE netlify/functions/provider-adapter.js ---
