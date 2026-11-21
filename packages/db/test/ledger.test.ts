import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient, pruneWebhookDeliveries, repoMonthSpendUsd, reviewCostEntry } from '../src';

const url = process.env.TEST_DATABASE_URL;

describe('reviewCostEntry', () => {
  it('writes nothing for a free run', () => {
    expect(reviewCostEntry({ repoId: 'r', reviewId: 'v', costUsd: 0 })).toEqual([]);
    const at = new Date('2026-11-02T10:00:00Z');
    expect(reviewCostEntry({ repoId: 'r', reviewId: 'v', costUsd: 0.0123456789, spentAt: at })).toEqual([
      { repoId: 'r', reviewId: 'v', costUsd: '0.012346', spentAt: at },
    ]);
  });
});

// Runs against the test database (pnpm db:test:prepare). Skipped when TEST_DATABASE_URL is unset.
describe.runIf(Boolean(url))('cost ledger and retention', () => {
  const prisma = createPrismaClient({ connectionString: url });
  afterAll(() => prisma.$disconnect());

  it('counts money in the month it was spent, whatever the review row’s age', async () => {
    const githubId = BigInt(Date.now()) + 7n;
    const installation = await prisma.installation.create({
      data: { githubId, accountLogin: 'ledger-org', accountType: 'Organization' },
    });
    const repo = await prisma.repo.create({
      data: { githubId, fullName: 'ledger-org/app', installationId: installation.id },
    });
    const pr = await prisma.pullRequest.create({
      data: {
        repoId: repo.id,
        number: 1,
        title: 't',
        author: 'a',
        baseRef: 'main',
        headRef: 'f',
        headSha: 'abc1234',
        url: 'u',
      },
    });
    // Reviewed in October, reviewed again in November: November pays for the re-run.
    const review = await prisma.review.create({
      data: {
        pullRequestId: pr.id,
        repoId: repo.id,
        headSha: 'abc1234',
        model: 'claude-sonnet-5-5',
        costUsd: '0.03',
        createdAt: new Date('2026-10-25T12:00:00Z'),
      },
    });
    await prisma.reviewCost.createMany({
      data: [
        ...reviewCostEntry({
          repoId: repo.id,
          reviewId: review.id,
          costUsd: 0.01,
          spentAt: new Date('2026-10-25T12:01:00Z'),
        }),
        ...reviewCostEntry({
          repoId: repo.id,
          reviewId: review.id,
          costUsd: 0.02,
          spentAt: new Date('2026-11-03T09:00:00Z'),
        }),
      ],
    });
    expect(await repoMonthSpendUsd(prisma, repo.id, new Date('2026-11-21T00:00:00Z'))).toBeCloseTo(0.02, 6);

    // A deleted review keeps its spend (the budget still counts it).
    await prisma.review.delete({ where: { id: review.id } });
    expect(await repoMonthSpendUsd(prisma, repo.id, new Date('2026-11-21T00:00:00Z'))).toBeCloseTo(0.02, 6);
    await prisma.installation.delete({ where: { id: installation.id } });
  });

  it('prunes webhook log rows older than 30 days', async () => {
    const stamp = Date.now();
    const now = new Date('2026-11-21T00:00:00Z');
    await prisma.webhookDelivery.createMany({
      data: [
        { deliveryId: `old-${stamp}`, event: 'ping', receivedAt: new Date('2026-10-01T00:00:00Z') },
        { deliveryId: `new-${stamp}`, event: 'ping', receivedAt: new Date('2026-11-20T00:00:00Z') },
      ],
    });
    expect(await pruneWebhookDeliveries(prisma, now)).toBeGreaterThanOrEqual(1);
    const left = await prisma.webhookDelivery.findMany({
      where: { deliveryId: { in: [`old-${stamp}`, `new-${stamp}`] } },
      select: { deliveryId: true },
    });
    expect(left.map((d) => d.deliveryId)).toEqual([`new-${stamp}`]);
    await prisma.webhookDelivery.deleteMany({ where: { deliveryId: `new-${stamp}` } });
  });
});
