// Writes a local .env from .env.example, wired to the mock GitHub, with fresh
// secrets and a throwaway GitHub App key. Never overwrites an existing file.
//   pnpm setup:local [--out path] [--database-url url] [--redis-url url]
// Defaults: Postgres postgresql://<your OS user>@localhost:5433/revo_dev (no password),
// Redis redis://localhost:6379/7. Pass the flags when yours run elsewhere, e.g.
//   pnpm setup:local --database-url postgresql://$USER@localhost:5432/revo_dev
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { userInfo } from 'node:os';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const defaultDatabaseUrl = `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5433/revo_dev`;
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: resolve(root, '.env') },
    'database-url': { type: 'string', default: defaultDatabaseUrl },
    'redis-url': { type: 'string', default: 'redis://localhost:6379/7' },
  },
});
const out = resolve(values.out);
if (existsSync(out)) {
  console.error(`${out} already exists; not overwriting it.`);
  console.error('Delete it (or pass --out other.env) to write a fresh one.');
  process.exit(1);
}

const databaseUrl = new URL(values['database-url']);
const redisUrl = new URL(values['redis-url']);
/** Same server as DATABASE_URL, database revo_test (pnpm db:test:prepare). */
const testDatabaseUrl = new URL(databaseUrl);
testDatabaseUrl.pathname = '/revo_test';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const secret = () => randomBytes(32).toString('base64url');

/** Local values: the mock GitHub (pnpm mock:github) and the offline review engine. */
const local = {
  DATABASE_URL: databaseUrl.href,
  TEST_DATABASE_URL: testDatabaseUrl.href,
  REDIS_URL: redisUrl.href,
  APP_URL: 'http://localhost:3830',
  GITHUB_APP_ID: '1',
  GITHUB_APP_SLUG: 'revo-dev',
  GITHUB_APP_PRIVATE_KEY: `"${privateKey.trim().replace(/\n/g, '\\n')}"`,
  GITHUB_WEBHOOK_SECRET: secret(),
  GITHUB_CLIENT_ID: 'mock-client-id',
  GITHUB_CLIENT_SECRET: 'mock-client-secret',
  AUTH_SECRET: secret(),
  REVO_ENGINE: 'fake',
  // The demo account (pnpm db:seed) has already used this month's free reviews in its seeded
  // history; as an owner account it has no free-tier limit, so new mock PRs get reviewed.
  REVO_OWNER_ACCOUNTS: 'northwind-labs',
  // Locally, review a few seconds after a push instead of 90.
  REVIEW_DEBOUNCE_SECONDS: '5',
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
console.log(`  DATABASE_URL=${databaseUrl.href}`);
console.log(`  REDIS_URL=${redisUrl.href}`);
console.log('Add ANTHROPIC_API_KEY and clear REVO_ENGINE to review with Claude.');

/** True when something accepts TCP connections on host:port within a second. */
function listening(host, port) {
  return new Promise((done) => {
    const socket = connect({ host, port: Number(port) });
    const finish = (ok) => {
      socket.destroy();
      done(ok);
    };
    socket.setTimeout(1000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

const pgHost = databaseUrl.hostname || 'localhost';
const pgPort = databaseUrl.port || '5432';
if (!(await listening(pgHost, pgPort))) {
  console.warn(`\nNothing answers on ${pgHost}:${pgPort} (Postgres, DATABASE_URL).`);
  if (pgPort !== '5432' && (await listening(pgHost, 5432))) {
    console.warn('A server answers on 5432, the usual Postgres port. Write the .env again for it:');
    console.warn(
      `  rm .env && pnpm setup:local --database-url ${databaseUrl.href.replace(`:${pgPort}/`, ':5432/')}`,
    );
  } else {
    console.warn(
      'Start Postgres, or edit DATABASE_URL and TEST_DATABASE_URL in .env (README, "Run it locally").',
    );
  }
}
const redisHost = redisUrl.hostname || 'localhost';
const redisPort = redisUrl.port || '6379';
if (!(await listening(redisHost, redisPort))) {
  console.warn(
    `\nNothing answers on ${redisHost}:${redisPort} (Redis, REDIS_URL). Start Redis before pnpm dev.`,
  );
}
