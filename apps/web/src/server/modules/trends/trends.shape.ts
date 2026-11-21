/**
 * Pure shaping of the trends aggregates (SQL rows → chart series with every
 * bucket present). No database access: tested in trends.shape.test.ts.
 */
import { CATEGORIES, CategorySchema, type Category } from '@revo/shared';
import { precisionRate, roundTo } from '~/lib/metrics';
import { dayKey, fillBuckets } from '~/lib/time-buckets';
import type { TrendsDto } from '~/types/trends';

export type ScoreRow = { day: Date; repo_id: string; avg_score: number; reviews: number };
export type CategoryRow = { bucket: Date; category: string; findings: number };
export type FeedbackRow = { bucket: Date; useful: number; wrong: number };
export type CostRow = { day: Date; cost: number; reviews: number };

/** One point per day with each repo's average score (null on days without a review). */
export function shapeScoreByRepo(
  keys: readonly string[],
  rows: readonly ScoreRow[],
  repoIds: readonly string[],
): TrendsDto['scoreByRepo'] {
  const byDay = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const key = dayKey(r.day);
    const day = byDay.get(key) ?? new Map<string, number>();
    day.set(r.repo_id, roundTo(r.avg_score, 1)!);
    byDay.set(key, day);
  }
  return keys.map((date) => {
    const day = byDay.get(date);
    const point: { date: string } & Record<string, number | null | string> = { date };
    for (const id of repoIds) point[id] = day?.get(id) ?? null;
    return point;
  });
}

/** Confirmed findings per category per bucket; unknown categories are dropped. */
export function shapeFindingsByCategory(
  keys: readonly string[],
  rows: readonly CategoryRow[],
): TrendsDto['findingsByCategory'] {
  const empty = () => Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const byBucket = new Map<string, Record<Category, number>>();
  for (const r of rows) {
    const category = CategorySchema.safeParse(r.category);
    if (!category.success) continue;
    const key = dayKey(r.bucket);
    const counts = byBucket.get(key) ?? empty();
    counts[category.data] += r.findings;
    byBucket.set(key, counts);
  }
  return keys.map((date) => ({ date, ...(byBucket.get(date) ?? empty()) }));
}

export function shapePrecision(
  keys: readonly string[],
  rows: readonly FeedbackRow[],
): TrendsDto['precision'] {
  return fillBuckets(
    keys,
    rows,
    (r) => dayKey(r.bucket),
    (r, date) => ({ date, useful: r.useful, wrong: r.wrong, rate: precisionRate(r.useful, r.wrong) }),
    (date) => ({ date, useful: 0, wrong: 0, rate: null }),
  );
}

export function shapeCost(keys: readonly string[], rows: readonly CostRow[]): TrendsDto['costByDay'] {
  return fillBuckets(
    keys,
    rows,
    (r) => dayKey(r.day),
    (r, date) => ({ date, costUsd: roundTo(r.cost, 6)!, reviews: r.reviews }),
    (date) => ({ date, costUsd: 0, reviews: 0 }),
  );
}
