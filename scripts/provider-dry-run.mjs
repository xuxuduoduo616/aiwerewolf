// Offline contract check: dry-run never claims that credentials or model access work.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { handleEvent: handler, DOUBAO_MODEL_IDS } = require('../netlify/functions/provider-adapter.cjs');

export const runProviderDryRun = async () => {
  const previous = process.env.ADAPTER_DRY_RUN;
  const previousOrigin = process.env.ALLOWED_ORIGIN;
  process.env.ADAPTER_DRY_RUN = 'true';
  process.env.ALLOWED_ORIGIN = 'https://offline.invalid';
  const probe = async (model) => {
    const response = await handler({
      httpMethod: 'POST', headers: { origin: 'https://offline.invalid' },
      body: JSON.stringify({ model, prompt: 'offline contract probe' }),
    });
    const body = JSON.parse(response.body);
    return response.statusCode === 200 && body.text === '[dry-run] mock response' && body.model_used === model;
  };
  try {
    const results = await Promise.all(['gemini-3.6-flash', ...DOUBAO_MODEL_IDS].map(probe));
    return results.every(Boolean);
  } finally {
    if (previous === undefined) delete process.env.ADAPTER_DRY_RUN;
    else process.env.ADAPTER_DRY_RUN = previous;
    if (previousOrigin === undefined) delete process.env.ALLOWED_ORIGIN;
    else process.env.ALLOWED_ORIGIN = previousOrigin;
  }
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const ok = await runProviderDryRun();
  console.log(ok ? 'Provider dry-run: offline contract passed; no access was verified.' : 'Provider dry-run: contract failed.');
  if (!ok) process.exitCode = 1;
}
