import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Sandboxed machines that cannot write the user-level browser cache can run
// `PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium` to keep the
// browsers inside node_modules. Prefer that local install when it exists;
// every other environment (including CI) keeps Playwright's default cache.
const configDir = path.dirname(fileURLToPath(import.meta.url));
const localBrowsers = path.join(configDir, 'node_modules', 'playwright-core', '.local-browsers');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(localBrowsers)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
}

const PORT = 5173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // 5173 is one of the ports where src/ai/geminiAdapter.ts short-circuits to
    // the local, key-free provider fallback. --strictPort keeps the base URL
    // honest instead of silently moving to a port without that fallback.
    command: `npm run dev -- --port ${PORT} --strictPort --host 127.0.0.1`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
