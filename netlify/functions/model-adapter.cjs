// --- START OF FILE netlify/functions/model-adapter.js ---
//
// Server-side model adapter: whitelist, cost guard, timeout, retry, and a
// deterministic fallback chain (primary -> secondary -> local-fallback).
//
// No API keys live in this source. The real key is read from process.env only
// when a live call is made. For tests and offline work, set ADAPTER_DRY_RUN=true
// to get a deterministic mock response without any network call.

// Model whitelist. IDs match real public model names; costs are approximate
// per-1k-token figures used only for the local cost guard, not billing truth.
const MODEL_REGISTRY = {
  // Gemini 2.5 Flash — confirmed Google AI model.
  'gemini-2.5-flash': { costPer1kTokens: 0.00015, timeout: 15000, maxRetries: 2 },
  // Gemini 2.0 Flash Experimental.
  'gemini-2.0-flash-exp': { costPer1kTokens: 0.00010, timeout: 10000, maxRetries: 2 },
  // Local fallback — 0 cost, never calls out.
  'local-fallback': { costPer1kTokens: 0, timeout: 500, maxRetries: 0 },
};

const DEFAULT_ROUTE = 'gemini-2.5-flash';
const SECONDARY_ROUTE = 'gemini-2.0-flash-exp';
const LOCAL_FALLBACK = 'local-fallback';
const COST_CEILING_PER_CALL = 0.005; // $0.005 max per call.

// Rough token estimate: ~4 chars per token is a common heuristic.
const estimateTokens = (text) => Math.ceil((text || '').length / 4);

const estimateCost = (model, tokens) => {
  const cfg = MODEL_REGISTRY[model];
  if (!cfg) return Infinity;
  return (tokens / 1000) * cfg.costPer1kTokens;
};

const getAllowedOrigin = (requestOrigin) => {
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return requestOrigin || '*';
  return allowed.includes(requestOrigin) ? requestOrigin : allowed[0];
};

const MAX_PROMPT_LEN = 8000;

// Attempt a single live model call with a timeout. Returns text or throws.
const callModel = async (model, prompt, options) => {
  const cfg = MODEL_REGISTRY[model];
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('missing-api-key');

  const { GoogleGenAI } = require('@google/genai');
  const client = new GoogleGenAI({ apiKey });

  const controller = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('timeout')), cfg.timeout);
  });
  const generation = client.models
    .generateContent({
      model,
      contents: prompt,
      config: {
        responseMimeType: options.responseMimeType,
        temperature: options.temperature,
      },
    })
    .then((res) => res.text);

  return Promise.race([generation, controller]);
};

// Try a model with retries. Returns text or null on exhaustion.
const tryModelWithRetries = async (model, prompt, options) => {
  const cfg = MODEL_REGISTRY[model];
  if (!cfg) return null;
  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      const text = await callModel(model, prompt, options);
      if (typeof text === 'string' && text.length > 0) return text;
    } catch (err) {
      // Swallow and retry; details are logged server-side only.
      console.error(`model-adapter ${model} attempt ${attempt} failed:`, err?.message || err);
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

  // Route: honor a whitelisted request, else default.
  const requested = body.model;
  const primary = MODEL_REGISTRY[requested] ? requested : DEFAULT_ROUTE;

  // Reject unknown models explicitly (only if a model was named and unknown).
  if (requested && !MODEL_REGISTRY[requested]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Model not in whitelist' }) };
  }

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

  // Fallback chain: primary -> secondary -> local-fallback signal.
  const chain = [primary];
  if (primary !== SECONDARY_ROUTE) chain.push(SECONDARY_ROUTE);

  for (const model of chain) {
    const text = await tryModelWithRetries(model, prompt, options);
    if (text) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          text,
          model_used: model,
          cost_estimate: estimateCost(model, tokens),
          fallback_used: model !== primary,
        }),
      };
    }
  }

  // All live models failed — signal the caller to use its local speech library.
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
exports.MODEL_REGISTRY = MODEL_REGISTRY;
exports.COST_CEILING_PER_CALL = COST_CEILING_PER_CALL;
exports.DEFAULT_ROUTE = DEFAULT_ROUTE;

// --- END OF FILE netlify/functions/model-adapter.js ---
