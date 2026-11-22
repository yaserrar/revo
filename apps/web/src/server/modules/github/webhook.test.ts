import { generateKeyPairSync, randomBytes, randomInt } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '@revo/db';
import { createMockGithubServer, MOCK_APP_ID, type MockPull } from '@revo/mock-github';
import { reviewJobIdPrefix } from '@revo/shared';
import type { pullRequestsService as PullRequestsService } from '../pull-requests/pull-requests.service';

// Integration: real revo_test database, real Redis (db 7, throwaway prefix), mock GitHub on a random port.
const SECRET = 'webhook-test-secret';
const prefix = `revo-test-${randomBytes(4).toString('hex')}`;
const { server, app } = createMockGithubServer({ baseUrl: 'http://localhost' });
const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL });
const installationId = 800_000_000 + randomInt(1, 99_999_999);
const repoId = installationId + 1;
const otherRepoId = installationId + 2;
const login = `webhook-test-${installationId}`;

let handle: (req: Request) => Promise<Response>;
let pullRequestsService: typeof PullRequestsService;
let queue: Queue;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  Object.assign(process.env, {
    GITHUB_WEBHOOK_SECRET: SECRET,
    GITHUB_APP_ID: String(MOCK_APP_ID),
    GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_API_URL: `http://localhost:${(server.address() as AddressInfo).port}`,
    REVO_QUEUE_PREFIX: prefix,
    REVIEW_DEBOUNCE_SECONDS: '60',
  });
  // Modules read the environment when first imported.
  handle = (await import('./webhook.handler')).handleGithubWebhook;
  pullRequestsService = (await import('../pull-requests/pull-requests.service')).pullRequestsService;
  queue = (await import('~/server/queue/review-queue')).reviewQueue();
  app.addInstallation({
    id: installationId,
    account: { id: installationId, login, type: 'Organization' },
    repos: [
      { id: repoId, name: 'shop' },
      { id: otherRepoId, name: 'docs' },
    ],
  });
});

afterAll(async () => {
  await prisma.installation.deleteMany({ where: { githubId: BigInt(installationId) } });
  await prisma.webhookDelivery.deleteMany({ where: { installationGithubId: BigInt(installationId) } });
  await queue?.obliterate({ force: true });
  await queue?.close();
  await prisma.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function signed(event: string, payload: Record<string, unknown>, secret = SECRET) {
  const req = app.webhookRequest(event, payload, secret);
  return {
    id: req.id,
    request: () =>
      new Request('http://localhost/api/github/webhook', {
        method: 'POST',
        headers: req.headers,
        body: req.body,
      }),
  };
}

async function send(event: string, payload: Record<string, unknown>) {
  const res = await handle(signed(event, payload).request());
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const install = () =>
  send('installation', {
    action: 'created',
    installation: app.installationPayload(app.installations.get(installationId)!),
    repositories: app.reposOf(installationId).map((r) => app.repoPayload(r)),
  });

const ORDERS =
  'export function total(withTax: number, discount: number) {\n  return withTax - discount;\n}\n';
const open = (extra: { draft?: boolean; author?: string; authorType?: 'User' | 'Bot' } = {}) =>
  app.openPull({
    repoId,
    title: 'Totals',
    files: [{ path: 'src/total.ts', before: null, after: ORDERS }],
    ...extra,
  });

/** Start of the job ids of one commit (each enqueue adds its own suffix). */
const jobIdOf = (pull: MockPull, sha: string) =>
  `${reviewJobIdPrefix(repoId)}${pull.number}-${sha.toLowerCase()}-`;
const checksOf = (pull: MockPull) =>
  [...app.checkRuns.values()].filter((c) => c.repoId === repoId && c.headSha === app.head(pull).sha);

const reviewOf = (pull: MockPull) =>
  prisma.review.findFirst({
    where: { repo: { githubId: BigInt(repoId) }, headSha: app.head(pull).sha },
  });

describe('POST /api/github/webhook', () => {
  it('rejects a missing or wrong signature with 401', async () => {
    const payload = { action: 'created', installation: { id: installationId } };
    expect((await handle(signed('installation', payload, 'not-the-secret').request())).status).toBe(401);
    const unsigned = new Request('http://localhost/api/github/webhook', {
      method: 'POST',
      headers: { 'x-github-event': 'installation', 'x-github-delivery': 'x' },
      body: JSON.stringify(payload),
    });
    const res = await handle(unsigned);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('refuses a body above 25 MB before reading it (413)', async () => {
    const res = await handle(
      new Request('http://localhost/api/github/webhook', {
        method: 'POST',
        headers: {
          'x-github-event': 'ping',
          'x-github-delivery': 'big',
          'x-hub-signature-256': `sha256=${'0'.repeat(64)}`,
          'content-length': String(300 * 1024 * 1024),
        },
        body: '{}',
      }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });

  it('answers ping', async () => {
    expect(await send('ping', { zen: 'Design for failure.' })).toMatchObject({
      status: 200,
      body: { ok: true },
    });
  });

  it('saves the installation and its repos, enabled with default settings', async () => {
    expect((await install()).status).toBe(200);
    // The account's own id is kept: the free tier counts per account, across reinstalls.
    const installation = await prisma.installation.findUniqueOrThrow({
      where: { githubId: BigInt(installationId) },
    });
    expect(installation.accountGithubId).toBe(BigInt(installationId));
    const repos = await prisma.repo.findMany({
      where: { installation: { githubId: BigInt(installationId) } },
      include: { settings: true },
      orderBy: { githubId: 'asc' },
    });
    expect(repos.map((r) => [r.fullName, r.enabled, r.settings?.threshold])).toEqual([
      [`${login}/shop`, true, 70],
      [`${login}/docs`, true, 70],
    ]);
  });

  it('opens a PR: PR row, queued review, "reviewing" check and a debounced job', async () => {
    const pull = open();
    const { status, body } = await send('pull_request', app.pullRequestEvent('opened', pull));
    expect([status, body.outcome]).toEqual([200, 'queued']);

    const pr = await prisma.pullRequest.findFirstOrThrow({
      where: { repo: { githubId: BigInt(repoId) }, number: pull.number },
    });
    expect(pr).toMatchObject({ state: 'open', headSha: app.head(pull).sha, author: 'maya-chen' });
    const review = await reviewOf(pull);
    expect(review).toMatchObject({ status: 'queued', trigger: 'auto' });
    const checks = checksOf(pull);
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ name: 'Revo', status: 'in_progress', title: 'Revo: reviewing…' });
    expect(review!.checkRunId).toBe(BigInt(checks[0]!.id));

    const job = (await queue.getDelayed()).find((j) => j.id?.startsWith(jobIdOf(pull, app.head(pull).sha)));
    expect(await job?.getState()).toBe('delayed');
    expect(job?.opts.delay).toBe(60_000);
  });

  it('ignores a repeated delivery and a repeated head SHA', async () => {
    const pull = open();
    const delivery = signed('pull_request', app.pullRequestEvent('opened', pull));
    expect((await handle(delivery.request())).status).toBe(200);
    const again = await handle(delivery.request());
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true });
    // Same commit, new delivery (e.g. reopened): still one review and one check.
    expect((await send('pull_request', app.pullRequestEvent('reopened', pull))).body.outcome).toBe(
      'duplicate',
    );
    expect(checksOf(pull)).toHaveLength(1);
    const logged = await prisma.webhookDelivery.findUniqueOrThrow({ where: { deliveryId: delivery.id } });
    expect(logged.processedAt).not.toBeNull();
  });

  it('a new push replaces the job still waiting for the PR', async () => {
    const pull = open();
    await send('pull_request', app.pullRequestEvent('opened', pull));
    const first = app.head(pull).sha;
    app.pushCommit(pull, [{ path: 'src/total.ts', after: ORDERS.replace('withTax - discount', 'withTax') }]);
    expect((await send('pull_request', app.pullRequestEvent('synchronize', pull))).body.outcome).toBe(
      'queued',
    );
    const ids = (await queue.getDelayed()).map((j) => j.id ?? '');
    expect(ids.some((id) => id.startsWith(jobIdOf(pull, app.head(pull).sha)))).toBe(true);
    expect(ids.some((id) => id.startsWith(jobIdOf(pull, first)))).toBe(false);
  });

  it('skips drafts until they are ready, and bots, with neutral checks', async () => {
    const draft = open({ draft: true });
    expect((await send('pull_request', app.pullRequestEvent('opened', draft))).body.outcome).toBe(
      'skipped:draft',
    );
    expect(checksOf(draft)[0]).toMatchObject({
      status: 'completed',
      conclusion: 'neutral',
      title: 'Draft pull request',
    });
    draft.draft = false;
    expect((await send('pull_request', app.pullRequestEvent('ready_for_review', draft))).body.outcome).toBe(
      'queued',
    );
    expect(await reviewOf(draft)).toMatchObject({ status: 'queued', skipReason: null });

    const bot = open({ author: 'dependabot[bot]', authorType: 'Bot' });
    expect((await send('pull_request', app.pullRequestEvent('opened', bot))).body.outcome).toBe(
      'skipped:bot',
    );
  });

  it('skips with "Monthly budget reached" when the budget is spent', async () => {
    const repo = await prisma.repo.findUniqueOrThrow({ where: { githubId: BigInt(repoId) } });
    await prisma.repoSettings.update({ where: { repoId: repo.id }, data: { monthlyBudgetUsd: 0 } });
    const pull = open();
    expect((await send('pull_request', app.pullRequestEvent('opened', pull))).body.outcome).toBe(
      'skipped:budget',
    );
    expect(checksOf(pull)[0]).toMatchObject({ conclusion: 'neutral', title: 'Monthly budget reached' });
    await prisma.repoSettings.update({ where: { repoId: repo.id }, data: { monthlyBudgetUsd: 20 } });
  });

  it('marks a closed PR merged without a review', async () => {
    const pull = open();
    await send('pull_request', app.pullRequestEvent('opened', pull));
    pull.state = 'closed';
    pull.merged = true;
    pull.mergedAt = new Date().toISOString();
    pull.closedAt = pull.mergedAt;
    expect((await send('pull_request', app.pullRequestEvent('closed', pull))).body.outcome).toBe('closed');
    const pr = await prisma.pullRequest.findFirstOrThrow({
      where: { repo: { githubId: BigInt(repoId) }, number: pull.number },
    });
    expect(pr.state).toBe('merged');
    expect(pr.mergedAt).not.toBeNull();
  });

  it('"Review again" queues a manual job now, with a fresh check, once at a time', async () => {
    const pull = open();
    await send('pull_request', app.pullRequestEvent('opened', pull));
    const review = (await reviewOf(pull))!;
    await prisma.review.update({ where: { id: review.id }, data: { status: 'done', score: 88 } });
    const allowed = [review.repoId];

    const reader = await prisma.user.create({
      data: { githubId: BigInt(installationId) + 10n, login: 'reader' },
    });
    const writer = await prisma.user.create({
      data: { githubId: BigInt(installationId) + 11n, login: 'writer' },
    });
    await prisma.repoAccess.createMany({
      data: [
        { userId: reader.id, repoId: review.repoId, permission: 'read' },
        { userId: writer.id, repoId: review.repoId, permission: 'write' },
      ],
    });
    await expect(
      pullRequestsService.reviewAgain(review.pullRequestId, allowed, reader.id),
    ).rejects.toMatchObject({
      status: 403,
    });

    await pullRequestsService.reviewAgain(review.pullRequestId, allowed, writer.id);
    const manual = (await queue.getWaiting()).find(
      (j) => j.data.prNumber === pull.number && j.data.trigger === 'manual',
    );
    expect(manual?.data).toMatchObject({ requestedByUserId: writer.id, headSha: app.head(pull).sha });
    expect(await reviewOf(pull)).toMatchObject({ status: 'queued', trigger: 'manual' });
    expect(checksOf(pull)).toHaveLength(2);

    await expect(
      pullRequestsService.reviewAgain(review.pullRequestId, allowed, writer.id),
    ).rejects.toMatchObject({
      status: 409,
    });
    await expect(pullRequestsService.reviewAgain(review.pullRequestId, [], writer.id)).rejects.toMatchObject({
      status: 404,
    });
    await prisma.user.deleteMany({ where: { id: { in: [reader.id, writer.id] } } });
  });

  it('queues again a commit whose review was stuck in progress (its job was lost)', async () => {
    const pull = open();
    await send('pull_request', app.pullRequestEvent('opened', pull));
    const review = (await reviewOf(pull))!;
    expect((await send('pull_request', app.pullRequestEvent('reopened', pull))).body.outcome).toBe(
      'duplicate',
    );
    await prisma.$executeRaw`UPDATE "Review" SET "updatedAt" = now() - interval '31 minutes' WHERE id = ${review.id}`;
    expect((await send('pull_request', app.pullRequestEvent('reopened', pull))).body.outcome).toBe('queued');
    const ids = (await queue.getDelayed()).map((j) => j.id ?? '');
    expect(ids.filter((id) => id.startsWith(jobIdOf(pull, app.head(pull).sha)))).toHaveLength(1);
  });

  it('removes repos taken out of the installation', async () => {
    const removed = app.removeRepos([otherRepoId]);
    const { status } = await send('installation_repositories', {
      action: 'removed',
      installation: app.installationPayload(app.installations.get(installationId)!),
      repositories_added: [],
      repositories_removed: removed.map((r) => ({ id: r.id, full_name: r.fullName })),
    });
    expect(status).toBe(200);
    expect(await prisma.repo.findUnique({ where: { githubId: BigInt(otherRepoId) } })).toBeNull();
  });

  it('deletes everything when the app is uninstalled (spec 14)', async () => {
    const { installation } = app.removeInstallation(installationId);
    expect(
      (await send('installation', { action: 'deleted', installation: app.installationPayload(installation) }))
        .status,
    ).toBe(200);
    expect(await prisma.installation.findUnique({ where: { githubId: BigInt(installationId) } })).toBeNull();
    expect(await prisma.repo.count({ where: { githubId: BigInt(repoId) } })).toBe(0);
    expect(await prisma.review.count({ where: { repo: { githubId: BigInt(repoId) } } })).toBe(0);
    // Nothing else is kept: no webhook log rows but the uninstall's own, no queue jobs.
    expect(
      await prisma.webhookDelivery.count({ where: { installationGithubId: BigInt(installationId) } }),
    ).toBe(1);
    const jobs = await queue.getJobs(['waiting', 'delayed', 'completed', 'failed']);
    expect(jobs.filter((j) => j.id?.startsWith(reviewJobIdPrefix(repoId)))).toEqual([]);
  });
});
