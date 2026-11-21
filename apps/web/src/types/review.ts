import type { FeedbackDto, FeedbackOutcome, FindingDto, ReviewDto, ScoreBreakdownRow } from '@revo/shared';

export type ReviewDetailDto = {
  review: ReviewDto;
  /** Threshold of the repo now (the check is red under it). */
  threshold: number;
  /** Score of the review before this one on the same PR, for "58 → 72". */
  previousScore: number | null;
  breakdown: ScoreBreakdownRow[];
  /** Confirmed findings, in review order. */
  findings: FindingDto[];
  /** Findings pass 2 rejected, with their reasons. */
  rejected: FindingDto[];
};

/** Result of saving or clearing feedback on a finding. */
export type FindingFeedbackDto = {
  findingId: string;
  myFeedback: FeedbackDto | null;
  feedbackCounts: Record<FeedbackOutcome, number>;
};
