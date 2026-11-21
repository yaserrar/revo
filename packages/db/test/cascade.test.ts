import { afterAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../src';

const url = process.env.TEST_DATABASE_URL;

// Runs against the test database (pnpm db:test:prepare). Skipped when TEST_DATABASE_URL is unset.
describe.runIf(Boolean(url))('uninstall cascade (spec 14)', () => {
  const prisma = createPrismaClient({ connectionString: url });
  afterAll(() => prisma.$disconnect());

  it('deletes repos, PRs, reviews, findings, feedback and access with the installation', async () => {
    const githubId = BigInt(Date.now());
    const user = await prisma.user.create({ data: { githubId, login: `cascade-${githubId}` } });
    const installation = await prisma.installation.create({
      data: { githubId, accountLogin: 'cascade-org', accountType: 'Organization' },
    });
    const repo = await prisma.repo.create({
      data: {
        githubId,
        fullName: 'cascade-org/app',
        installationId: installation.id,
        settings: { create: {} },
      },
    });
    await prisma.repoAccess.create({ data: { userId: user.id, repoId: repo.id } });
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
    const review = await prisma.review.create({
      data: {
        pullRequestId: pr.id,
        repoId: repo.id,
        headSha: 'abc1234',
        model: 'claude-sonnet-5-5',
        findings: {
          create: {
            index: 0,
            category: 'bug',
            severity: 'major',
            file: 'a.ts',
            lineStart: 1,
            lineEnd: 1,
            title: 't',
            explanation: 'e',
            suggestion: 's',
            snippet: 'x',
            confidence: 0.9,
            verified: true,
          },
        },
      },
      include: { findings: true },
    });
    await prisma.feedback.create({
      data: { findingId: review.findings[0]!.id, userId: user.id, outcome: 'useful' },
    });
    await prisma.reviewCost.create({ data: { repoId: repo.id, reviewId: review.id, costUsd: '0.1' } });

    await prisma.installation.delete({ where: { id: installation.id } });

    expect(await prisma.repo.count({ where: { id: repo.id } })).toBe(0);
    expect(await prisma.repoSettings.count({ where: { repoId: repo.id } })).toBe(0);
    expect(await prisma.pullRequest.count({ where: { id: pr.id } })).toBe(0);
    expect(await prisma.review.count({ where: { id: review.id } })).toBe(0);
    expect(await prisma.finding.count({ where: { reviewId: review.id } })).toBe(0);
    expect(await prisma.feedback.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.repoAccess.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.reviewCost.count({ where: { repoId: repo.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
    await prisma.user.delete({ where: { id: user.id } });
  });
});
