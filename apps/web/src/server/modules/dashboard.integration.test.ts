/**
 * Dashboard services against the test database (TEST_DATABASE_URL via
 * vitest.config.ts): access scoping, list filters, review detail, feedback,
 * overview and trends aggregation. Creates its own installation with unique
 * GitHub ids and deletes it (cascade) afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpError } from '../http/errors';
import { prisma } from '../config/prisma';
import { feedbackService } from './findings/feedback.service';
import { overviewService } from './overview/overview.service';
import { pullRequestsService } from './pull-requests/pull-requests.service';
import { reposService } from './repos/repos.service';
import { reviewsService } from './reviews/reviews.service';
import { trendsService } from './trends/trends.service';

const HOUR = 3_600_000;
const now = new Date();
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);
const base = 900_000_000 + Math.floor(Math.random() * 90_000_000);

const ids = {
  installation: '',
  repoA: '',
  repoB: '',
  user: '',
  pr1: '',
  pr2: '',
  pr3: '',
  prB: '',
  r1old: '',
  r1new: '',
  fUseful: '',
  fWrong: '',
  fRejected: '',
};

function prData(repoId: string, n: number, title: string, state: 'open' | 'merged' | 'closed' = 'open') {
  return {
    repoId,
    number: n,
    title,
    author: n % 2 ? 'ana' : 'bo',
    baseRef: 'main',
    headRef: `feat/${n}`,
    headSha: `abcdef${n}`.padEnd(40, '0'),
    url: `https://github.com/test/r/pull/${n}`,
    state,
    openedAt: ago(48),
  };
}

const finding = (over: Record<string, unknown>) => ({
  index: 0,
  category: 'bug',
  severity: 'major' as const,
  file: 'src/pricing.ts',
  lineStart: 10,
  lineEnd: 12,
  title: 'Discount applied after tax',
  explanation: 'Customers pay too much.',
  suggestion: 'Apply the discount first.',
  snippet: 'const total = tax(subtotal) - discount;',
  confidence: 0.9,
  verified: true,
  ...over,
});

beforeAll(async () => {
  const inst = await prisma.installation.create({
    data: { githubId: base, accountLogin: `itest-${base}`, accountType: 'Organization' },
  });
  ids.installation = inst.id;
  const repoA = await prisma.repo.create({
    data: {
      githubId: base + 1,
      fullName: `itest-${base}/alpha`,
      installationId: inst.id,
      settings: { create: { threshold: 70, monthlyBudgetUsd: 20 } },
    },
  });
  const repoB = await prisma.repo.create({
    data: { githubId: base + 2, fullName: `itest-${base}/beta`, installationId: inst.id },
  });
  ids.repoA = repoA.id;
  ids.repoB = repoB.id;
  const user = await prisma.user.create({ data: { githubId: base + 3, login: `itest-user-${base}` } });
  ids.user = user.id;
  await prisma.repoAccess.createMany({
    data: [
      { userId: user.id, repoId: repoA.id, permission: 'admin' },
      { userId: user.id, repoId: repoB.id, permission: 'read' },
    ],
  });

  const pr1 = await prisma.pullRequest.create({
    data: prData(repoA.id, 11, 'Apply promo codes at checkout'),
  });
  const pr2 = await prisma.pullRequest.create({ data: prData(repoA.id, 12, 'Faster search', 'merged') });
  const pr3 = await prisma.pullRequest.create({ data: prData(repoA.id, 13, 'Refactor 100% of cart') });
  const prB = await prisma.pullRequest.create({ data: prData(repoB.id, 14, 'Secret beta work') });
  Object.assign(ids, { pr1: pr1.id, pr2: pr2.id, pr3: pr3.id, prB: prB.id });

  const r1old = await prisma.review.create({
    data: {
      pullRequestId: pr1.id,
      repoId: repoA.id,
      headSha: 'a'.repeat(40),
      status: 'done',
      score: 76,
      label: 'needs_a_look',
      passed: true,
      model: 'claude-sonnet-5-5',
      costUsd: '0.200000',
      filesReviewed: 4,
      createdAt: ago(3),
      findings: {
        create: [
          finding({ index: 0 }),
          finding({ index: 1, category: 'security', file: 'src/users.ts', title: 'User id from body' }),
          finding({
            index: 2,
            verified: false,
            rejectReason: 'Already validated upstream.',
            title: 'Unchecked input',
          }),
        ],
      },
    },
    include: { findings: true },
  });
  const r1new = await prisma.review.create({
    data: {
      pullRequestId: pr1.id,
      repoId: repoA.id,
      headSha: 'b'.repeat(40),
      status: 'done',
      score: 96,
      label: 'good_to_merge',
      passed: true,
      model: 'claude-sonnet-5-5',
      costUsd: '0.100000',
      filesReviewed: 4,
      createdAt: ago(1),
      findings: { create: [finding({ severity: 'minor', category: 'missing-test', title: 'No test' })] },
    },
  });
  await prisma.review.create({
    data: {
      pullRequestId: pr2.id,
      repoId: repoA.id,
      headSha: 'c'.repeat(40),
      status: 'done',
      score: 100,
      label: 'good_to_merge',
      passed: true,
      model: 'claude-sonnet-5-5',
      costUsd: '0.050000',
      createdAt: ago(2),
    },
  });
  await prisma.review.create({
    data: {
      pullRequestId: pr3.id,
      repoId: repoA.id,
      headSha: 'd'.repeat(40),
      status: 'running',
      model: 'x',
      createdAt: ago(0.1),
    },
  });
  await prisma.review.create({
    data: {
      pullRequestId: prB.id,
      repoId: repoB.id,
      headSha: 'e'.repeat(40),
      status: 'done',
      score: 40,
      label: 'changes_needed',
      passed: false,
      model: 'claude-sonnet-5-5',
      costUsd: '5.000000',
      createdAt: ago(1),
      findings: { create: [finding({ severity: 'blocker', category: 'security' }), finding({ index: 1 })] },
    },
  });
  // The dated cost ledger the worker writes with each run (spent when the review ran).
  const costed = await prisma.review.findMany({
    where: { repoId: { in: [repoA.id, repoB.id] }, costUsd: { gt: 0 } },
    select: { id: true, repoId: true, costUsd: true, createdAt: true },
  });
  await prisma.reviewCost.createMany({
    data: costed.map((r) => ({ repoId: r.repoId, reviewId: r.id, costUsd: r.costUsd, spentAt: r.createdAt })),
  });
  ids.r1old = r1old.id;
  ids.r1new = r1new.id;
  ids.fUseful = r1old.findings.find((f) => f.index === 0)!.id;
  ids.fWrong = r1old.findings.find((f) => f.index === 1)!.id;
  ids.fRejected = r1old.findings.find((f) => !f.verified)!.id;
  await prisma.feedback.createMany({
    data: [
      { findingId: ids.fUseful, userId: user.id, outcome: 'useful', createdAt: ago(2) },
      {
        findingId: ids.fWrong,
        userId: user.id,
        outcome: 'wrong',
        note: 'Handled by middleware',
        createdAt: ago(2),
      },
    ],
  });
});

afterAll(async () => {
  if (ids.installation) await prisma.installation.delete({ where: { id: ids.installation } });
  if (ids.user) await prisma.user.delete({ where: { id: ids.user } });
  await prisma.$disconnect();
});

const onlyA = () => [ids.repoA];
const both = () => [ids.repoA, ids.repoB];
const listQuery = { sort: 'lastReviewed', dir: 'desc', page: 1, pageSize: 25 } as const;

async function httpStatus(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    if (err instanceof HttpError) return err.status;
    throw err;
  }
}

describe('pullRequestsService.list', () => {
  it('only returns PRs of accessible repos, latest review first', async () => {
    const page = await pullRequestsService.list(onlyA(), listQuery);
    expect(page.total).toBe(3);
    expect(page.items.map((p) => p.number)).toEqual([13, 11, 12]);
    const pr1 = page.items.find((p) => p.number === 11)!;
    expect(pr1.latestReview).toMatchObject({ score: 96, status: 'done' });
    expect(pr1.severityCounts).toEqual({ blocker: 0, major: 0, minor: 1 });
  });

  it('filters by score range, blockers, state, author and search', async () => {
    const all = both();
    const score = await pullRequestsService.list(all, { ...listQuery, scoreMin: 90 });
    expect(score.items.map((p) => p.number).sort()).toEqual([11, 12]);
    const blockers = await pullRequestsService.list(all, { ...listQuery, hasBlockers: true });
    expect(blockers.items.map((p) => p.number)).toEqual([14]);
    const merged = await pullRequestsService.list(all, { ...listQuery, state: ['merged'] });
    expect(merged.items.map((p) => p.number)).toEqual([12]);
    const byAuthor = await pullRequestsService.list(all, { ...listQuery, author: ['bo'] });
    expect(byAuthor.items.map((p) => p.number).sort()).toEqual([12, 14]);
    const search = await pullRequestsService.list(all, { ...listQuery, q: 'promo' });
    expect(search.items.map((p) => p.number)).toEqual([11]);
    const byNumber = await pullRequestsService.list(all, { ...listQuery, q: '#13' });
    expect(byNumber.items.map((p) => p.number)).toEqual([13]);
    const literal = await pullRequestsService.list(all, { ...listQuery, q: '100%' });
    expect(literal.items.map((p) => p.number)).toEqual([13]);
  });

  it('sorts by score and paginates', async () => {
    const asc = await pullRequestsService.list(both(), {
      ...listQuery,
      sort: 'score',
      dir: 'asc',
      pageSize: 2,
    });
    expect(asc.items.map((p) => p.number)).toEqual([14, 11]);
    expect(asc.pageCount).toBe(2);
    const second = await pullRequestsService.list(both(), {
      ...listQuery,
      sort: 'score',
      dir: 'asc',
      pageSize: 2,
      page: 2,
    });
    expect(second.items.map((p) => p.number)).toEqual([12, 13]);
  });
});

describe('pullRequestsService.detail', () => {
  it('hides PRs of repos the user cannot access (404)', async () => {
    expect(await httpStatus(pullRequestsService.detail(ids.prB, onlyA(), ids.user))).toBe(404);
  });

  it('explains why "Review again" is unavailable', async () => {
    expect((await pullRequestsService.detail(ids.pr1, onlyA(), ids.user)).reviewAgain).toEqual({
      allowed: true,
      block: null,
      reason: null,
    });
    expect((await pullRequestsService.detail(ids.pr2, onlyA(), ids.user)).reviewAgain.block).toBe('not_open');
    expect((await pullRequestsService.detail(ids.pr3, onlyA(), ids.user)).reviewAgain.block).toBe(
      'in_progress',
    );
    const pr1 = await pullRequestsService.detail(ids.pr1, onlyA(), ids.user);
    expect(pr1.reviews.map((r) => r.score)).toEqual([96, 76]);
  });

  it('needs write access for "Review again" (403 otherwise)', async () => {
    const where = { userId_repoId: { userId: ids.user, repoId: ids.repoA } };
    await prisma.repoAccess.update({ where, data: { permission: 'triage' } });
    try {
      const pr = await pullRequestsService.detail(ids.pr1, onlyA(), ids.user);
      expect(pr.reviewAgain).toMatchObject({ allowed: false, block: 'no_permission' });
      expect(await httpStatus(pullRequestsService.reviewAgain(ids.pr1, onlyA(), ids.user))).toBe(403);
    } finally {
      await prisma.repoAccess.update({ where, data: { permission: 'admin' } });
    }
  });

  it('lets a review stuck in progress for 30 minutes be queued again', async () => {
    const stuck = await prisma.review.findFirstOrThrow({ where: { pullRequestId: ids.pr3 } });
    await prisma.$executeRaw`UPDATE "Review" SET "updatedAt" = now() - interval '31 minutes' WHERE id = ${stuck.id}`;
    try {
      const pr = await pullRequestsService.detail(ids.pr3, onlyA(), ids.user);
      expect(pr.reviewAgain.block).toBe(null);
    } finally {
      await prisma.review.update({ where: { id: stuck.id }, data: { status: 'running' } });
    }
  });

  it('refuses "Review again" with BUDGET_REACHED when the budget is spent', async () => {
    await prisma.repoSettings.update({ where: { repoId: ids.repoA }, data: { monthlyBudgetUsd: 0 } });
    try {
      const pr = await pullRequestsService.detail(ids.pr1, onlyA(), ids.user);
      expect(pr.reviewAgain.block).toBe('budget');
      expect(pr.budget.reached).toBe(true);
      expect(await httpStatus(pullRequestsService.reviewAgain(ids.pr1, onlyA(), ids.user))).toBe(402);
    } finally {
      await prisma.repoSettings.update({ where: { repoId: ids.repoA }, data: { monthlyBudgetUsd: 20 } });
    }
  });
});

describe('reviewsService.detail', () => {
  it('splits confirmed and rejected findings with the breakdown and previous score', async () => {
    const old = await reviewsService.detail(ids.r1old, onlyA(), ids.user);
    expect(old.findings).toHaveLength(2);
    expect(old.rejected).toHaveLength(1);
    expect(old.rejected[0]!.rejectReason).toBe('Already validated upstream.');
    expect(old.breakdown).toEqual([
      { severity: 'blocker', count: 0, points: 0 },
      { severity: 'major', count: 2, points: -24 },
      { severity: 'minor', count: 0, points: 0 },
    ]);
    expect(old.previousScore).toBeNull();
    expect(old.findings[0]!.myFeedback?.outcome).toBe('useful');
    const latest = await reviewsService.detail(ids.r1new, onlyA(), ids.user);
    expect(latest.previousScore).toBe(76);
  });
});

describe('feedbackService', () => {
  it('sets, changes and clears the user feedback', async () => {
    const set = await feedbackService.set(ids.fUseful, onlyA(), ids.user, {
      outcome: 'wrong',
      note: 'Tax is 0 here',
    });
    expect(set.myFeedback).toMatchObject({ outcome: 'wrong', note: 'Tax is 0 here' });
    expect(set.feedbackCounts).toEqual({ useful: 0, wrong: 1 });
    const cleared = await feedbackService.clear(ids.fUseful, onlyA(), ids.user);
    expect(cleared.myFeedback).toBeNull();
    const back = await feedbackService.set(ids.fUseful, onlyA(), ids.user, { outcome: 'useful' });
    expect(back.feedbackCounts).toEqual({ useful: 1, wrong: 0 });
  });

  it('refuses rejected findings (422) and repos without access (404)', async () => {
    expect(
      await httpStatus(feedbackService.set(ids.fRejected, onlyA(), ids.user, { outcome: 'useful' })),
    ).toBe(422);
    expect(
      await httpStatus(feedbackService.set(ids.fUseful, [ids.repoB], ids.user, { outcome: 'useful' })),
    ).toBe(404);
  });
});

describe('overviewService', () => {
  it('aggregates only accessible repos', async () => {
    const o = await overviewService.get(onlyA(), now);
    expect(o.repoCount).toBe(1);
    expect(o.prsReviewed.thisWeek).toBe(2);
    expect(o.avgScore.thisWeek).toBe(91); // (76 + 96 + 100) / 3
    expect(o.precision).toMatchObject({ useful: 1, wrong: 1, rate: 0.5 });
    expect(o.cost.spentUsd).toBeCloseTo(0.35, 6);
    expect(o.cost.budgetUsd).toBe(20);
    expect(o.budgetReached).toEqual([]);
    // One row per PR (its latest review), with the score of the review before it.
    expect(o.latestReviews.map((r) => r.status)).toEqual(['running', 'done', 'done']);
    expect(o.latestReviews.find((r) => r.id === ids.r1new)).toMatchObject({ score: 96, previousScore: 76 });
    expect(o.threshold).toBe(70);
    expect(o.scoreByDay).toHaveLength(30);
    expect(o.prsReviewed.perDay).toHaveLength(14);
  });

  it('reports a repo over budget', async () => {
    await prisma.repoSettings.create({ data: { repoId: ids.repoB, monthlyBudgetUsd: 2 } });
    try {
      const o = await overviewService.get(both(), now);
      expect(o.budgetReached.map((b) => b.repoFullName)).toEqual([`itest-${base}/beta`]);
    } finally {
      await prisma.repoSettings.delete({ where: { repoId: ids.repoB } });
    }
  });
});

describe('trendsService', () => {
  it('aggregates scores, categories, precision, cost and top files', async () => {
    const t = await trendsService.get(onlyA(), { range: '7d' }, now);
    expect(t.bucket).toBe('day');
    expect(t.totals).toMatchObject({ reviews: 3, prs: 2, findings: 3 });
    expect(t.totals.precision).toBe(0.5);
    expect(t.totals.avgCostPerPrUsd).toBeCloseTo(0.175, 6);
    expect(t.scoreByRepo).toHaveLength(7);
    expect(t.repos.map((r) => r.name)).toEqual(['alpha']);
    const categories = t.findingsByCategory.reduce(
      (sum, b) => sum + b.bug + b.security + b['missing-test'],
      0,
    );
    expect(categories).toBe(3);
    expect(t.topFiles[0]).toMatchObject({ file: 'src/pricing.ts', findings: 2, majors: 1 });
    expect(t.costByDay.reduce((s, d) => s + d.costUsd, 0)).toBeCloseTo(0.35, 6);
  });

  it('uses weekly buckets for 30 days and refuses a repo without access', async () => {
    const t = await trendsService.get(both(), { range: '30d' }, now);
    expect(t.bucket).toBe('week');
    expect(t.findingsByCategory.length).toBeGreaterThanOrEqual(5);
    expect(await httpStatus(trendsService.get(onlyA(), { range: '30d', repo: ids.repoB }, now))).toBe(404);
  });
});

describe('reposService', () => {
  it('lists repos with stats and saves settings', async () => {
    const list = await reposService.list(both(), now);
    const alpha = list.items.find((r) => r.id === ids.repoA)!;
    expect(alpha).toMatchObject({ prsReviewed: 2, avgScore: 91 });
    expect(alpha.budget.spentUsd).toBeCloseTo(0.35, 6);
    const beta = list.items.find((r) => r.id === ids.repoB)!;
    expect(beta.budget).toMatchObject({ budgetUsd: 20, reached: false });

    const saved = await reposService.updateSettings(ids.repoB, {
      enabled: false,
      threshold: 80,
      ignoreGlobs: [' docs/** '],
      monthlyBudgetUsd: 3,
    });
    expect(saved).toMatchObject({
      enabled: false,
      threshold: 80,
      ignoreGlobs: ['docs/**'],
      monthlyBudgetUsd: 3,
    });
    const page = await reposService.settings(ids.repoB, false);
    expect(page.canEdit).toBe(false);
    expect(page.budget.reached).toBe(true);
    expect(page.models.map((m) => m.id)).toContain('claude-haiku-5-5');
  });
});
