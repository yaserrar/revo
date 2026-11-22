/**
 * Compile-time check that Prisma enums and @revo/shared constants hold the
 * same values. If one side changes without the other, typecheck fails here.
 */
import type {
  AccountType as SharedAccountType,
  AiAccess as SharedAiAccess,
  AiSource as SharedAiSource,
  FeedbackOutcome as SharedFeedbackOutcome,
  PrState as SharedPrState,
  RepoPermission as SharedRepoPermission,
  ReviewStatus as SharedReviewStatus,
  ReviewTrigger as SharedReviewTrigger,
  ScoreLabel as SharedScoreLabel,
  Severity as SharedSeverity,
  SkipReason as SharedSkipReason,
} from '@revo/shared';
import type {
  AccountType,
  AiAccess,
  AiSource,
  FeedbackOutcome,
  PrState,
  RepoPermission,
  ReviewStatus,
  ReviewTrigger,
  ScoreLabel,
  Severity,
  SkipReason,
} from './generated/prisma/enums';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type EnumParity = [
  Assert<Same<AccountType, SharedAccountType>>,
  Assert<Same<AiAccess, SharedAiAccess>>,
  Assert<Same<AiSource, SharedAiSource>>,
  Assert<Same<FeedbackOutcome, SharedFeedbackOutcome>>,
  Assert<Same<PrState, SharedPrState>>,
  Assert<Same<RepoPermission, SharedRepoPermission>>,
  Assert<Same<ReviewStatus, SharedReviewStatus>>,
  Assert<Same<ReviewTrigger, SharedReviewTrigger>>,
  Assert<Same<ScoreLabel, SharedScoreLabel>>,
  Assert<Same<Severity, SharedSeverity>>,
  Assert<Same<SkipReason, SharedSkipReason>>,
];
