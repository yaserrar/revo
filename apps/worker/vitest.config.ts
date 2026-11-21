import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Integration tests read TEST_DATABASE_URL and REDIS_URL from the repo's .env.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Integration files share Postgres and Redis: run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
