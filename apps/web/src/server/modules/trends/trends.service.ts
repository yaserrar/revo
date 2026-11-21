import 'server-only';
import { Prisma } from '@revo/db';
import { DEFAULT_THRESHOLD, splitFullName } from '@revo/shared';
import { precisionRate, roundTo, sharedThreshold } from '~/lib/metrics';
import { bucketKeys, windowStart, type BucketUnit } from '~/lib/time-buckets';
import { TREND_RANGE_DAYS, type TrendsQuery } from '~/schemas/trends';
import type { TrendsDto } from '~/types/trends';
import { prisma } from '../../config/prisma';
import { notFound } from '../../http/errors';
import {
  shapeCost,
  shapeFindingsByCategory,
  shapePrecision,
  shapeScoreByRepo,
  type CategoryRow,
  type CostRow,
  type FeedbackRow,
  type ScoreRow,
} from './trends.shape';

type TotalsRow = { reviews: number; prs: number; cost: number; avg_score: number | null };
type TopFileRow = { file: string; repo: string; findings: number; blockers: number; majors: number };

export const trendsService = {
  /** Every Trends chart for the accessible repos (or one of them), aggregated in SQL. */
  async get(accessible: string[], query: TrendsQuery, now = new Date()): Promise<TrendsDto> {
    if (query.repo && !accessible.includes(query.repo)) throw notFound('Repo');
    const ids = query.repo ? [query.repo] : accessible;
    const days = TREND_RANGE_DAYS[query.range];
    const from = windowStart(days, now);
    const unit: BucketUnit = days <= 7 ? 'day' : 'week';
    const unitSql = Prisma.raw(`'${unit}'`);

    const [repos, scoreRows, categoryRows, feedbackRows, costRows, totals, findingsTotal, topFiles] =
      await Promise.all([
        prisma.repo.findMany({
          where: { id: { in: ids } },
          select: { id: true, fullName: true, settings: { select: { threshold: true } } },
          orderBy: { fullName: 'asc' },
        }),
        prisma.$queryRaw<ScoreRow[]>`
          SELECT date_trunc('day', r."createdAt") AS day, r."repoId" AS repo_id,
            avg(r.score)::float8 AS avg_score, count(*)::int AS reviews
          FROM "Review" r
          WHERE r."repoId" = ANY(${ids}::text[]) AND r.status = 'done' AND r."createdAt" >= ${from}
          GROUP BY 1, 2`,
        prisma.$queryRaw<CategoryRow[]>`
          SELECT date_trunc(${unitSql}, r."createdAt") AS bucket, f.category, count(*)::int AS findings
          FROM "Finding" f JOIN "Review" r ON r.id = f."reviewId"
          WHERE r."repoId" = ANY(${ids}::text[]) AND r.status = 'done' AND f.verified
            AND r."createdAt" >= ${from}
          GROUP BY 1, 2`,
        prisma.$queryRaw<FeedbackRow[]>`
          SELECT date_trunc(${unitSql}, fb."createdAt") AS bucket,
            count(*) FILTER (WHERE fb.outcome = 'useful')::int AS useful,
            count(*) FILTER (WHERE fb.outcome = 'wrong')::int AS wrong
          FROM "Feedback" fb
            JOIN "Finding" f ON f.id = fb."findingId"
            JOIN "Review" r ON r.id = f."reviewId"
          WHERE r."repoId" = ANY(${ids}::text[]) AND fb."createdAt" >= ${from}
          GROUP BY 1`,
        prisma.$queryRaw<CostRow[]>`
          SELECT day, sum(cost)::float8 AS cost, sum(reviews)::int AS reviews
          FROM (
            SELECT date_trunc('day', c."spentAt") AS day, c."costUsd" AS cost, 0 AS reviews
            FROM "ReviewCost" c
            WHERE c."repoId" = ANY(${ids}::text[]) AND c."spentAt" >= ${from}
            UNION ALL
            SELECT date_trunc('day', r."createdAt"), 0, 1
            FROM "Review" r
            WHERE r."repoId" = ANY(${ids}::text[]) AND r."createdAt" >= ${from}
          ) spend
          GROUP BY 1`,
        prisma.$queryRaw<TotalsRow[]>`
          SELECT count(*) FILTER (WHERE r.status = 'done')::int AS reviews,
            count(DISTINCT r."pullRequestId") FILTER (WHERE r.status = 'done')::int AS prs,
            (SELECT coalesce(sum(c."costUsd"), 0) FROM "ReviewCost" c
              WHERE c."repoId" = ANY(${ids}::text[]) AND c."spentAt" >= ${from})::float8 AS cost,
            avg(r.score) FILTER (WHERE r.status = 'done')::float8 AS avg_score
          FROM "Review" r
          WHERE r."repoId" = ANY(${ids}::text[]) AND r."createdAt" >= ${from}`,
        prisma.finding.count({
          where: {
            verified: true,
            review: { repoId: { in: ids }, status: 'done', createdAt: { gte: from } },
          },
        }),
        prisma.$queryRaw<TopFileRow[]>`
          SELECT f.file, rp."fullName" AS repo, count(*)::int AS findings,
            count(*) FILTER (WHERE f.severity = 'blocker')::int AS blockers,
            count(*) FILTER (WHERE f.severity = 'major')::int AS majors
          FROM "Finding" f
            JOIN "Review" r ON r.id = f."reviewId"
            JOIN "Repo" rp ON rp.id = r."repoId"
          WHERE r."repoId" = ANY(${ids}::text[]) AND r.status = 'done' AND f.verified
            AND r."createdAt" >= ${from}
          GROUP BY f.file, rp."fullName"
          ORDER BY findings DESC, blockers DESC, majors DESC, f.file
          LIMIT 10`,
      ]);

    const dayKeys = bucketKeys(from, now, 'day');
    const bucketKeyList = bucketKeys(from, now, unit);
    const t = totals[0] ?? { reviews: 0, prs: 0, cost: 0, avg_score: null };
    const useful = feedbackRows.reduce((s, r) => s + r.useful, 0);
    const wrong = feedbackRows.reduce((s, r) => s + r.wrong, 0);

    return {
      range: query.range,
      from: from.toISOString(),
      to: now.toISOString(),
      bucket: unit,
      repos: repos.map((r) => ({ id: r.id, fullName: r.fullName, name: splitFullName(r.fullName).name })),
      threshold: sharedThreshold(repos.map((r) => r.settings?.threshold ?? DEFAULT_THRESHOLD)),
      totals: {
        reviews: t.reviews,
        prs: t.prs,
        findings: findingsTotal,
        costUsd: roundTo(t.cost, 6) ?? 0,
        avgCostPerPrUsd: t.prs > 0 ? roundTo(t.cost / t.prs, 6) : null,
        avgScore: roundTo(t.avg_score, 1),
        precision: precisionRate(useful, wrong),
      },
      scoreByRepo: shapeScoreByRepo(
        dayKeys,
        scoreRows,
        repos.map((r) => r.id),
      ),
      findingsByCategory: shapeFindingsByCategory(bucketKeyList, categoryRows),
      precision: shapePrecision(bucketKeyList, feedbackRows),
      costByDay: shapeCost(dayKeys, costRows),
      topFiles: topFiles.map((f) => ({
        file: f.file,
        repoFullName: f.repo,
        findings: f.findings,
        blockers: f.blockers,
        majors: f.majors,
      })),
    };
  },
};
