import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a production build (`pnpm --filter @revo/web build` first) on
 * port 3831 and the mock GitHub on 4830. Both start here unless already up
 * (a server already running must use the same settings: a 2 s debounce and
 * webhooks to 3831). The pipeline spec starts and stops its own worker.
 * Uses the installed Chrome, headless.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3831';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    headless: true,
  },
  webServer: [
    {
      command: `MOCK_WEBHOOK_URL=${BASE_URL}/api/github/webhook ../../tools/mock-github/node_modules/.bin/tsx ../../tools/mock-github/src/main.ts`,
      url: 'http://localhost:4830/health',
      reuseExistingServer: true,
    },
    {
      command: `REVO_TEST_MODE=1 REVO_ENABLE_DEV_KIT=1 REVIEW_DEBOUNCE_SECONDS=2 APP_URL=${BASE_URL} dotenv -e ../../.env -- next start -p 3831`,
      url: `${BASE_URL}/api/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
