const { GoogleGenAI } = require('@google/genai');

// Simple in-memory rate limiter (per warm instance).
// For production scale, use a durable store; this deters casual abuse.
const rateBuckets = new Map();
const RATE_LIMIT = 30;       // requests
const RATE_WINDOW = 60_000;  // per 60s per IP

const checkRateLimit = (ip) => {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_WINDOW;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  return bucket.count <= RATE_LIMIT;
};

// Allowed origins — override via ALLOWED_ORIGIN env var in Netlify.
const getAllowedOrigin = (requestOrigin) => {
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.length === 0) return requestOrigin || '*'; // dev fallback
  return allowed.includes(requestOrigin) ? requestOrigin : allowed[0];
};

const MAX_PROMPT_LEN = 8000;

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

  // Rate limit by client IP
  const ip = event.headers['x-nf-client-connection-ip']
    || event.headers['x-forwarded-for']
    || 'unknown';
  if (!checkRateLimit(ip)) {
    return { statusCode: 429, headers, body: JSON.stringify({ error: 'Rate limit exceeded. Try again shortly.' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured with API key' }) };
    }

    // Input validation
    let prompt = typeof body.prompt === 'string' ? body.prompt : '';
    if (!prompt || prompt.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing prompt' }) };
    }
    if (prompt.length > MAX_PROMPT_LEN) {
      prompt = prompt.slice(0, MAX_PROMPT_LEN);
    }

    // Whitelist models to prevent abuse of the key for arbitrary calls
    const ALLOWED_MODELS = new Set(['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']);
    const model = ALLOWED_MODELS.has(body.model) ? body.model : 'gemini-2.5-flash';

    const responseMimeType = body.responseMimeType === 'application/json' ? 'application/json' : 'text/plain';
    const temperature = typeof body.temperature === 'number'
      ? Math.max(0, Math.min(2, body.temperature))
      : 0.7;

    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model,
      contents: prompt,
      config: { responseMimeType, temperature },
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text: response.text }),
    };
  } catch (err) {
    console.error('Proxy error', err?.message || err);
    // Do not leak internal error details to the client
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'AI generation failed' }) };
  }
};
