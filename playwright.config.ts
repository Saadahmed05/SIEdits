import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8791);

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    // Use a preinstalled Chromium when PW_CHROMIUM_PATH is set; otherwise Playwright's own.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `rm -rf .tmp/e2e-data && npm run build && NODE_ENV=production DATA_DIR=.tmp/e2e-data PORT=${PORT} npx tsx src/server/index.ts`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    // AI keys are deliberately cleared: the core workflow must work without them.
    env: { ANTHROPIC_API_KEY: '', OPENAI_BASE_URL: '', OPENAI_MODEL: '' },
  },
});
