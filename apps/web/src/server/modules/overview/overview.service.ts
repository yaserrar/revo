import 'server-only';
import { decimalToNumber, startOfUtcMonth } from '@revo/db';
import { DEFAULT_THRESHOLD } from '@revo/shared';
import { precisionRate, roundTo, sharedThreshold } from '~/lib/metrics';
import { bucketKeys, dayKey, fillBuckets, windowStart } from '~/lib/time-buckets';
import type { OverviewDto } from '~/types/overview';
import { prisma } from '../../config/prisma';
import { presentBudget } from '../../presenters/repo.presenter';
import { budgetLimit } from '../repos/budget';

const DAY_MS = 86_400_000;
export const PRECISION_WINDOW_DAYS = 30;

type TotalsRow = {
  prs_this: number;
  prs_last: number;
  avg_this: number | null;
  avg_last: number | null;
  spent: number;
  prs_month: number;
};
type DayRow = { day: Date; avg_score: number | null; reviews: number; prs: number };
type CostDayRow = { day: Date; cost: number };
type SpendRow = { repo_id: string; spent: number };

export const overviewService = {
  async get(repoIds: string[], now = new Date()): Promise<OverviewDto> {
    const weekStart = new Date(now.getTime() - 7 * DAY_MS);
    const prevWeekStart = new Date(now.getTime() - 14 * DAY_MS);
    const monthStart = startOfUtcMonth(now);
    const from30 = windowStart(30, now);
    const ids = repoIds;

    // Money counts when it was spent (the ReviewCost ledger), like the worker's budget check.
    const [totals, days, costDays, spend, repos, feedback, latest] = await Promise.all([
      prisma.$queryRaw<TotalsRow[]>`
        SELECT
          count(DISTINCT r."pullRequestId") FILTER (WHERE r.status = 'done' AND r."createdAt" >= ${weekStart})::int AS prs_this,
          count(DISTINCT r."pullRequestId") FILTER (WHERE r.status = 'done' AND r."createdAt" >= ${prevWeekStart} AND r."createdAt" < ${weekStart})::int AS prs_last,
          avg(r.score) FILTER (WHERE r.status = 'done' AND r."createdAt" >= ${weekStart})::float8 AS avg_this,
          avg(r.score) FILTER (WHERE r.status = 'done' AND r."createdAt" >= ${prevWeekStart} AND r."createdAt" < ${weekStart})::float8 AS avg_last,
          (SELECT coalesce(sum(c."costUsd"), 0) FROM "ReviewCost" c
            WHERE c."repoId" = ANY(${ids}::text[]) AND c."spentAt" >= ${monthStart})::float8 AS spent,
          count(DISTINCT r."pullRequestId") FILTER (WHERE r.status = 'done' AND r."createdAt" >= ${monthStart})::int AS prs_month
        FROM "Review" r
        WHERE r."repoId" = ANY(${ids}::text[])`,
      prisma.$queryRaw<DayRow[]>`
        SELECT date_trunc('day', r."createdAt") AS day,
          avg(r.score) FILTER (WHERE r.status = 'done')::float8 AS avg_score,
          count(*) FILTER (WHERE r.status = 'done')::int AS reviews,
          count(DISTINCT r."pullRequestId") FILTER (WHERE r.status = 'done')::int AS prs
        FROM "Review" r
        WHERE r."repoId" = ANY(${ids}::text[]) AND r."createdAt" >= ${from30}
        GROUP BY 1`,
      prisma.$queryRaw<CostDayRow[]>`
        SELECT date_trunc('day', c."spentAt") AS day, coalesce(sum(c."costUsd"), 0)::float8 AS cost
        FROM "ReviewCost" c
        WHERE c."repoId" = ANY(${ids}::text[]) AND c."spentAt" >= ${monthStart}
        GROUP BY 1`,
      prisma.$queryRaw<SpendRow[]>`
        SELECT c."repoId" AS repo_id, coalesce(sum(c."costUsd"), 0)::float8 AS spent
        FROM "ReviewCost" c
        WHERE c."repoId" = ANY(${ids}::text[]) AND c."spentAt" >= ${monthStart}
        GROUP BY 1`,
      prisma.repo.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          fullName: true,
          enabled: true,
          settings: { select: { monthlyBudgetUsd: true, threshold: true } },
        },
      }),
      prisma.feedback.groupBy({
        by: ['outcome'],
        where: {
          createdAt: { gte: windowStart(PRECISION_WINDOW_DAYS, now) },
          finding: { review: { repoId: { in: ids } } },
        },
        _count: { _all: true },
      }),
      latestPerPullRequest(ids, LATEST_LIMIT),
    ]);

    const t = totals[0] ?? {
      prs_this: 0,
      prs_last: 0,
      avg_this: null,
      avg_last: null,
      spent: 0,
      prs_month: 0,
    };
    const spentByRepo = new Map(spend.map((s) => [s.repo_id, s.spent]));
    const budgets = repos.map((r) => presentBudget(r, spentByRepo.get(r.id) ?? 0, budgetLimit(r.settings)));
    const useful = feedback.find((f) => f.outcome === 'useful')?._count._all ?? 0;
    const wrong = feedback.find((f) => f.outcome === 'wrong')?._count._all ?? 0;
    const byDay = (keys: string[]) =>
      fillBuckets<DayRow, DayRow | null>(
        keys,
        days,
        (d) => dayKey(d.day),
        (d) => d,
        () => null,
      );

    const last14 = byDay(bucketKeys(windowStart(14, now), now, 'day'));
    const monthCost = fillBuckets<CostDayRow, number>(
      bucketKeys(monthStart, now, 'day'),
      costDays,
      (d) => dayKey(d.day),
      (d) => d.cost,
      () => 0,
    );
    const keys30 = bucketKeys(from30, now, 'day');

    return {
      repoCount: repos.length,
      prsReviewed: {
        thisWeek: t.prs_this,
        lastWeek: t.prs_last,
        perDay: last14.map((d) => d?.prs ?? 0),
      },
      avgScore: { thisWeek: roundTo(t.avg_this), lastWeek: roundTo(t.avg_last) },
      precision: { useful, wrong, rate: precisionRate(useful, wrong), windowDays: PRECISION_WINDOW_DAYS },
      cost: {
        monthStart: monthStart.toISOString(),
        spentUsd: roundTo(t.spent, 6) ?? 0,
        budgetUsd: budgets.filter((_, i) => repos[i]!.enabled).reduce((sum, b) => sum + b.budgetUsd, 0),
        perDay: monthCost.map((c) => roundTo(c, 6) ?? 0),
        avgPerPrUsd: t.prs_month > 0 ? roundTo(t.spent / t.prs_month, 6) : null,
      },
      budgetReached: budgets.filter((b) => b.reached && repos.find((r) => r.id === b.repoId)?.enabled),
      latestReviews: latest.map((r) => ({
        id: r.id,
        headSha: r.headSha,
        previousScore: r.previousScore,
        pullRequestId: r.pullRequestId,
        repoFullName: r.repo.fullName,
        prNumber: r.pullRequest.number,
        prTitle: r.pullRequest.title,
        author: r.pullRequest.author,
        authorAvatarUrl: r.pullRequest.authorAvatarUrl,
        status: r.status,
        skipReason: r.skipReason,
        score: r.score,
        label: r.label,
        passed: r.passed,
        costUsd: decimalToNumber(r.costUsd),
        createdAt: r.createdAt.toISOString(),
      })),
      scoreByDay: byDay(keys30).map((d, i) => ({
        date: keys30[i]!,
        avgScore: roundTo(d?.avg_score ?? null, 1),
        reviews: d?.reviews ?? 0,
      })),
      threshold: sharedThreshold(repos.map((r) => r.settings?.threshold ?? DEFAULT_THRESHOLD)),
    };
  },
};

const LATEST_LIMIT = 10;

/**
 * The latest review of each of the most recently reviewed PRs (one row per
 * PR, newest first), with the score of the PR's finished review before it.
 */
async function latestPerPullRequest(repoIds: string[], limit: number) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT l.id FROM (
      SELECT DISTINCT ON (r."pullRequestId") r.id, r."createdAt"
      FROM "Review" r
      WHERE r."repoId" = ANY(${repoIds}::text[])
      ORDER BY r."pullRequestId", r."createdAt" DESC
    ) l
    ORDER BY l."createdAt" DESC
    LIMIT ${limit}`;
  const ids = rows.map((r) => r.id);
  const reviews = await prisma.review.findMany({
    where: { id: { in: ids } },
    include: {
      repo: { select: { fullName: true } },
      pullRequest: { select: { number: true, title: true, author: true, authorAvatarUrl: true } },
    },
  });
  const earlier = await prisma.review.findMany({
    where: {
      pullRequestId: { in: reviews.map((r) => r.pullRequestId) },
      id: { notIn: ids },
      status: 'done',
      score: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    select: { pullRequestId: true, score: true, createdAt: true },
  });
  const byId = new Map(reviews.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const review = byId.get(id);
    if (!review) return [];
    const previous = earlier.find(
      (e) => e.pullRequestId === review.pullRequestId && e.createdAt < review.createdAt,
    );
    return [{ ...review, previousScore: previous?.score ?? null }];
  });
}
