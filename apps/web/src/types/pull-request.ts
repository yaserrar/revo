import type { PullRequestSummaryDto, RepoDto, ReviewDto } from '@revo/shared';
import type { BudgetDto } from './repo';

/** Why "Review again" is unavailable, or null when it is allowed. */
export type ReviewAgainBlock =
  | 'budget'
  | 'disabled'
  | 'not_open'
  | 'suspended'
  | 'in_progress'
  | 'no_permission'
  /** The account used its free reviews this month (free tier). */
  | 'free_limit'
  /** Revo's free reviews are paused for every account until next month. */
  | 'free_paused'
  | null;

export type PullRequestDetailDto = PullRequestSummaryDto & {
  body: string;
  headSha: string;
  repo: Pick<RepoDto, 'id' | 'fullName' | 'url' | 'enabled'>;
  /** Every review, newest first. */
  reviews: ReviewDto[];
  budget: BudgetDto;
  reviewAgain: { allowed: boolean; block: ReviewAgainBlock; reason: string | null };
};

/** Values offered by the PR list filters. */
export type PullRequestFiltersDto = {
  repos: Pick<RepoDto, 'id' | 'fullName'>[];
  authors: string[];
};

export type ReviewAgainResultDto = { reviewId: string; queuedAt: string };
