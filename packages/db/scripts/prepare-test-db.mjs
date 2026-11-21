// Applies every migration to the test database (TEST_DATABASE_URL). Tests clean up their own rows.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('TEST_DATABASE_URL is not set');
  process.exit(1);
}
const result = spawnSync('prisma', ['migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: url },
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
