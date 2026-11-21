import type { ReviewStatus, ScoreLabel, SkipReason } from '@revo/shared';
import type { BudgetDto } from './repo';

/** One row of "Latest reviews" on the overview. */
/** The latest review of one PR (one row per PR in the overview feed). */
export type ReviewFeedItemDto = {
  id: string;
  /** Commit the review is about. */
  headSha: string;
  /** Score of the PR's finished review before this one (null for the first). */
  previousScore: number | null;
  pullRequestId: string;
  repoFullName: string;
  prNumber: number;
  prTitle: string;
  author: string;
  authorAvatarUrl: string | null;
  status: ReviewStatus;
  skipReason: SkipReason | null;
  score: number | null;
  label: ScoreLabel | null;
  passed: boolean | null;
  costUsd: number;
  createdAt: string;
};

/** A day of the 30-day score chart; `avgScore` is null on days without a done review. */
export type ScoreDayDto = { date: string; avgScore: number | null; reviews: number };

export type OverviewDto = {
  /** Number of repos the user can see. 0 means "install Revo first". */
  repoCount: number;
  prsReviewed: { thisWeek: number; lastWeek: number; perDay: number[] };
  avgScore: { thisWeek: number | null; lastWeek: number | null };
  precision: { useful: number; wrong: number; rate: number | null; windowDays: number };
  cost: {
    monthStart: string;
    spentUsd: number;
    budgetUsd: number;
    perDay: number[];
    avgPerPrUsd: number | null;
  };
  /** Repos whose monthly budget is reached (the banner). */
  budgetReached: BudgetDto[];
  latestReviews: ReviewFeedItemDto[];
  scoreByDay: ScoreDayDto[];
  /** Red threshold shared by the user's repos, null when they differ. */
  threshold: number | null;
};
