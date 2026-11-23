/**
 * DTOs returned by the web app's API (built by presenters in
 * apps/web/src/server/presenters). Dates are ISO strings, money is a number
 * of USD, GitHub ids are numbers. Page-specific aggregates (overview, trends)
 * live in apps/web/src/types.
 */
import type {
  AccountType,
  Category,
  FeedbackOutcome,
  FeedbackSource,
  FindingResolution,
  PrState,
  ReviewStatus,
  ReviewTrigger,
  ScoreLabel,
  Severity,
  SkipReason,
} from './constants';
import type { AiSource } from './ai-access';
import type { RepoSettings } from './schemas/settings';

export type UserDto = {
  id: string;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

export type InstallationDto = {
  id: string;
  githubId: number;
  accountLogin: string;
  accountType: AccountType;
  accountAvatarUrl: string | null;
  suspended: boolean;
};

export type RepoDto = {
  id: string;
  githubId: number;
  fullName: string;
  /** owner part of fullName */
  owner: string;
  /** name part of fullName */
  name: string;
  private: boolean;
  enabled: boolean;
  installationId: string;
  url: string;
};

export type RepoSettingsDto = RepoSettings & { repoId: string; updatedAt: string };

export type ScoreBreakdownRow = { severity: Severity; count: number; points: number };

/** Count of confirmed findings per severity. */
export type SeverityCounts = Record<Severity, number>;

export type FeedbackDto = {
  id: string;
  outcome: FeedbackOutcome;
  source: FeedbackSource;
  note: string | null;
  user: Pick<UserDto, 'login' | 'avatarUrl'>;
  createdAt: string;
};

export type FindingDto = {
  id: string;
  reviewId: string;
  /** Position in the review (0 = most important). */
  index: number;
  category: Category;
  severity: Severity;
  /** Severity before pass 2 lowered it, when it did. */
  originalSeverity: Severity | null;
  file: string;
  lineStart: number;
  lineEnd: number;
  title: string;
  explanation: string;
  suggestion: string;
  /** Code lines for display (at most 30). */
  snippet: string;
  /** Line number of the first line of `snippet` in the new file. */
  snippetStartLine: number;
  confidence: number;
  /** true = confirmed by pass 2, false = rejected. */
  verified: boolean;
  rejectReason: string | null;
  posted: boolean;
  /** The signed-in user's feedback, if any. */
  myFeedback: FeedbackDto | null;
  /** Every source: dashboard buttons, 👍/👎 on GitHub, and a later push that fixed the code (useful). */
  feedbackCounts: Record<FeedbackOutcome, number>;
  /** How many of those came from GitHub reactions and from fixes. */
  feedbackFrom: { github: number; fixed: number };
  /** Exact new code for the flagged lines: the one-click suggested change on GitHub. */
  replacement: string | null;
  /** Head commit of the earlier review that first found it, when it is still open from then. */
  openSince: string | null;
  /** What happened after this review: a later push fixed it, or a person dismissed it. */
  resolution: FindingResolution | null;
  /** The commit whose review saw the fix. */
  resolvedSha: string | null;
};

export type ReviewDto = {
  id: string;
  pullRequestId: string;
  headSha: string;
  status: ReviewStatus;
  skipReason: SkipReason | null;
  trigger: ReviewTrigger;
  score: number | null;
  label: ScoreLabel | null;
  passed: boolean | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Cache-read input tokens. */
  cachedTokens: number;
  /** Cache-write input tokens (the context written to the prompt cache). */
  cacheWriteTokens: number;
  costUsd: number;
  durationMs: number | null;
  filesReviewed: number;
  filesSkipped: number;
  skippedFiles: string[];
  notes: string[];
  error: string | null;
  /** What paid for this run: Revo's free tier, the account's own key, or the Claude subscription. Null on rows saved before the field (those count as Revo's) and on runs that have not started. */
  aiSource: AiSource | null;
  createdAt: string;
  finishedAt: string | null;
};

export type PullRequestSummaryDto = {
  id: string;
  repo: Pick<RepoDto, 'id' | 'fullName'>;
  number: number;
  title: string;
  author: string;
  authorAvatarUrl: string | null;
  state: PrState;
  draft: boolean;
  url: string;
  baseRef: string;
  headRef: string;
  latestReview: Pick<
    ReviewDto,
    'id' | 'status' | 'score' | 'label' | 'passed' | 'headSha' | 'createdAt' | 'costUsd' | 'skipReason'
  > | null;
  /** Confirmed findings of the latest done review. */
  severityCounts: SeverityCounts;
  lastReviewedAt: string | null;
  openedAt: string;
};
