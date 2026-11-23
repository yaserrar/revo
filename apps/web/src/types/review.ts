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
  /** Problems of the previous review that this review's commit fixed. */
  fixed: FixedFindingDto[];
};

/** A problem an earlier review found and a later commit fixed (its flagged lines changed). */
export type FixedFindingDto = Pick<
  FindingDto,
  'id' | 'reviewId' | 'category' | 'severity' | 'file' | 'lineStart' | 'lineEnd' | 'title'
>;

/** Result of saving or clearing feedback on a finding. */
export type FindingFeedbackDto = {
  findingId: string;
  myFeedback: FeedbackDto | null;
  feedbackCounts: Record<FeedbackOutcome, number>;
  feedbackFrom: FindingDto['feedbackFrom'];
};
