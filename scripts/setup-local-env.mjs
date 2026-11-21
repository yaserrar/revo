// Writes a local .env from .env.example, wired to the mock GitHub, with fresh
// secrets and a throwaway GitHub App key. Never overwrites an existing file.
//   pnpm setup:local [--out path]
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const { values } = parseArgs({ options: { out: { type: 'string', default: resolve(root, '.env') } } });
const out = resolve(values.out);
if (existsSync(out)) {
  console.error(`${out} already exists; not overwriting it.`);
  process.exit(1);
}

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const secret = () => randomBytes(32).toString('base64url');

/** Local values: the mock GitHub (pnpm mock:github) and the offline review engine. */
const local = {
  APP_URL: 'http://localhost:3830',
  GITHUB_APP_ID: '1',
  GITHUB_APP_SLUG: 'revo-dev',
  GITHUB_APP_PRIVATE_KEY: `"${privateKey.trim().replace(/\n/g, '\\n')}"`,
  GITHUB_WEBHOOK_SECRET: secret(),
  GITHUB_CLIENT_ID: 'mock-client-id',
  GITHUB_CLIENT_SECRET: 'mock-client-secret',
  AUTH_SECRET: secret(),
  REVO_ENGINE: 'fake',
  GITHUB_OAUTH_BASE_URL: 'http://localhost:4830',
  GITHUB_API_URL: 'http://localhost:4830',
  DOMAIN: '',
};

const lines = readFileSync(resolve(root, '.env.example'), 'utf8')
  .split('\n')
  .map((line) => {
    const key = /^([A-Z0-9_]+)=/.exec(line)?.[1];
    return key && key in local ? `${key}=${local[key]}` : line;
  });
writeFileSync(out, lines.join('\n'), { mode: 0o600 });
console.log(`Wrote ${out} for local development (mock GitHub on :4830, fake review engine).`);
console.log('Add ANTHROPIC_API_KEY and clear REVO_ENGINE to review with Claude.');
