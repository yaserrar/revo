import { generateKeyPairSync, randomInt } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import pino from 'pino';
import { createPrismaClient, type PrismaClient } from '@revo/db';
import { createGithubApp } from '@revo/github';
import {
  createMockGithubServer,
  MOCK_APP_ID,
  type MockAppState,
  type MockFileChange,
  type MockPull,
} from '@revo/mock-github';
import { fakeEngine, type ReviewEngine } from '@revo/review';
import type { ReviewJobPayload } from '@revo/shared';
import type { ReviewDeps } from '../src/review/job';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/**
 * A mock GitHub on a random port with one fresh installation and repo, the
 * same installation and repo in revo_test, and the worker's dependencies.
 * Ids are random so test files never collide with each other or the seed.
 */
export async function createWorld() {
  const { server, app } = createMockGithubServer({ baseUrl: 'http://localhost' });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const apiUrl = `http://localhost:${(server.address() as AddressInfo).port}`;

  const prisma: PrismaClient = createPrismaClient({ connectionString: TEST_DATABASE_URL });
  const installationGithubId = 900_000_000 + randomInt(1, 99_999_999);
  const repoGithubId = installationGithubId + 1;
  const login = `worker-test-${installationGithubId}`;
  app.addInstallation({
    id: installationGithubId,
    account: { id: installationGithubId, login, type: 'Organization' },
    repos: [{ id: repoGithubId, name: 'shop' }],
  });
  app.setBaseFiles(repoGithubId, {
    'tsconfig.json': '{ "compilerOptions": { "paths": { "~/*": ["./src/*"] } } }\n',
    'src/lib/money.ts': 'export const roundCents = (v: number) => Math.round(v * 100) / 100;\n',
  });
  const installation = await prisma.installation.create({
    data: { githubId: BigInt(installationGithubId), accountLogin: login, accountType: 'Organization' },
  });
  const repo = await prisma.repo.create({
    data: {
      githubId: BigInt(repoGithubId),
      fullName: `${login}/shop`,
      installationId: installation.id,
      settings: { create: {} },
    },
  });

  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const github = createGithubApp({ appId: MOCK_APP_ID, privateKey, apiUrl });
  const log = pino({ level: 'silent' });

  const deps = (engine: ReviewEngine = fakeEngine): ReviewDeps => ({
    prisma,
    github,
    engine,
    log,
    appUrl: 'https://revo.example.com',
  });

  const openPull = (files: MockFileChange[], extra: Partial<Parameters<MockAppState['openPull']>[0]> = {}) =>
    app.openPull({ repoId: repoGithubId, title: 'Add order totals', files, ...extra });

  const payload = (pull: MockPull, extra: Partial<ReviewJobPayload> = {}): ReviewJobPayload => ({
    installationGithubId,
    repoGithubId,
    repoFullName: repo.fullName,
    prNumber: pull.number,
    headSha: app.head(pull).sha,
    trigger: 'auto',
    enqueuedAt: new Date().toISOString(),
    ...extra,
  });

  const activity = (pull: MockPull) => {
    const shas = new Set(pull.commits.map((c) => c.sha));
    return {
      checkRuns: [...app.checkRuns.values()].filter((c) => c.repoId === repoGithubId && shas.has(c.headSha)),
      comments: [...app.issueComments.values()].filter(
        (c) => c.repoId === repoGithubId && c.number === pull.number,
      ),
      reviewComments: app.reviewComments.filter((c) => c.repoId === repoGithubId && c.number === pull.number),
    };
  };

  const close = async () => {
    await prisma.installation.deleteMany({ where: { id: installation.id } });
    await prisma.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return { app, prisma, repo, installation, repoGithubId, deps, openPull, payload, activity, close };
}

export type World = Awaited<ReturnType<typeof createWorld>>;

/** A file with a blocker (SQL interpolation), a major (discount after tax) and a minor (unchecked JSON.parse). */
export const ORDERS_V1 = [
  "import { roundCents } from '~/lib/money';",
  '',
  'export function orderTotal(subtotal: number, taxRate: number, discount: number): number {',
  '  const withTax = subtotal * (1 + taxRate);',
  '  return roundCents(withTax - discount);',
  '}',
  '',
  'export function findOrder(db: { query(sql: string): unknown }, id: string) {',
  '  return db.query(`SELECT * FROM orders WHERE id = ${id}`);',
  '}',
  '',
  'export function readPayload(raw: string) {',
  '  return JSON.parse(raw);',
  '}',
  '',
].join('\n');

/** Same file with the SQL fixed: the discount and JSON.parse findings remain. */
export const ORDERS_V2 = ORDERS_V1.replace(
  'return db.query(`SELECT * FROM orders WHERE id = ${id}`);',
  "return db.query('SELECT * FROM orders WHERE id = $1');",
);
