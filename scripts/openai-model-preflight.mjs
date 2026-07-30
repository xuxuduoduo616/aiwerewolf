// Read-only OpenAI model-access preflight.
//
// This script performs exactly two GET requests to model metadata endpoints.
// It never sends a generation request, prints credentials, or prints upstream
// response bodies. Success requires both responses to return their exact model
// IDs, so availability is an atomic yes/no release gate.
//
// Usage:
//   OPENAI_API_KEY=... npm run preflight:openai-models

// Set OPENAI_API_KEY in the server/terminal environment; never put its value in
// source, command history shared as evidence, or generated reports.

import { pathToFileURL } from 'node:url';

export const OPENAI_MODEL_IDS = Object.freeze(['gpt-5.5', 'gpt-5.6-luna']);
export const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_PREFLIGHT_TIMEOUT_MS = 5_000;

const classifyStatus = (status) => {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server';
  return 'http-error';
};

const probeOneModel = async ({ model, apiKey, fetchImpl, timeoutMs }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${OPENAI_API_BASE_URL}/models/${encodeURIComponent(model)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { model, status: 'failed', reason: classifyStatus(response.status) };
    }
    let metadata;
    try {
      metadata = await response.json();
    } catch {
      return { model, status: 'failed', reason: 'malformed-metadata' };
    }
    if (!metadata || metadata.id !== model) {
      return { model, status: 'failed', reason: 'model-id-mismatch' };
    }
    return { model, status: 'ok', reason: 'exact-model-id' };
  } catch (err) {
    const reason = err && err.name === 'AbortError' ? 'timeout' : 'network';
    return { model, status: 'failed', reason };
  } finally {
    clearTimeout(timer);
  }
};

export const probeOpenAIModels = async ({
  apiKey = process.env.OPENAI_API_KEY || '',
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_PREFLIGHT_TIMEOUT_MS,
} = {}) => {
  if (!apiKey) {
    return {
      ok: false,
      results: OPENAI_MODEL_IDS.map((model) => ({ model, status: 'skipped', reason: 'missing-key' })),
    };
  }
  if (typeof fetchImpl !== 'function') {
    return {
      ok: false,
      results: OPENAI_MODEL_IDS.map((model) => ({ model, status: 'failed', reason: 'fetch-unavailable' })),
    };
  }

  const results = await Promise.all(
    OPENAI_MODEL_IDS.map((model) => probeOneModel({ model, apiKey, fetchImpl, timeoutMs }))
  );
  return { ok: results.every((result) => result.status === 'ok'), results };
};

const main = async () => {
  const result = await probeOpenAIModels();
  for (const entry of result.results) {
    console.log(`${entry.status === 'ok' ? 'PASS' : 'FAIL'} ${entry.model}: ${entry.reason}`);
  }
  console.log(result.ok ? 'PASS atomic OpenAI model access' : 'FAIL atomic OpenAI model access');
  if (!result.ok) process.exitCode = 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error('FAIL OpenAI model preflight: internal error');
    process.exitCode = 1;
  });
}
