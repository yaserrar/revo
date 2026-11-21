import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
