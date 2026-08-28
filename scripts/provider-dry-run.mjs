// Offline contract check: dry-run never claims that credentials or model access work.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { handler } = require('../netlify/functions/provider-adapter.cjs');

export const runProviderDryRun = async () => {
  const previous = process.env.ADAPTER_DRY_RUN;
  const previousOrigin = process.env.ALLOWED_ORIGIN;
  process.env.ADAPTER_DRY_RUN = 'true';
  process.env.ALLOWED_ORIGIN = 'https://offline.invalid';
  try {
    const response = await handler({
      httpMethod: 'POST', headers: { origin: 'https://offline.invalid' },
      body: JSON.stringify({ model: 'gemini-3.6-flash', prompt: 'offline contract probe' }),
    });
    const body = JSON.parse(response.body);
    return response.statusCode === 200 && body.text === '[dry-run] mock response' && body.model_used === 'gemini-3.6-flash';
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
