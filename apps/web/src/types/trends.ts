import type { Category, RepoDto } from '@revo/shared';

export const TREND_RANGES = ['7d', '30d', '90d'] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

export type TrendSeriesRepo = Pick<RepoDto, 'id' | 'fullName' | 'name'>;

export type TrendsDto = {
  range: TrendRange;
  from: string;
  to: string;
  /** Bucket size of the category and precision charts. */
  bucket: 'day' | 'week';
  repos: TrendSeriesRepo[];
  /** Red threshold shared by the repos in scope (the selected one's), null when they differ. */
  threshold: number | null;
  totals: {
    reviews: number;
    prs: number;
    findings: number;
    costUsd: number;
    avgCostPerPrUsd: number | null;
    avgScore: number | null;
    precision: number | null;
  };
  /** Per day: `date` plus the average score of each repo id (null when no review). */
  scoreByRepo: ({ date: string } & Record<string, number | null | string>)[];
  /** Per bucket: confirmed findings per category. */
  findingsByCategory: ({ date: string } & Record<Category, number>)[];
  /** Per bucket: feedback counts and the rate (null without feedback). */
  precision: { date: string; useful: number; wrong: number; rate: number | null }[];
  /** Per day: total cost and number of reviews. */
  costByDay: { date: string; costUsd: number; reviews: number }[];
  topFiles: { file: string; repoFullName: string; findings: number; blockers: number; majors: number }[];
};
