import {
  freeTierUsageEntry,
  reviewCostEntry,
  type FreeTierAccount,
  type PrismaClient,
  type Prisma,
} from '@revo/db';
import type { PullRequestInfo } from '@revo/github';
import type { ReviewedFinding, ReviewOutcome } from '@revo/review';
import type { AiSource, ReviewTrigger, SkipReason } from '@revo/shared';

type DoneOutcome = Extract<ReviewOutcome, { status: 'done' }>;

/** The GitHub account a run bills (its Revo-paid spend goes to the free-tier ledger). */
export type BilledAccount = Omit<FreeTierAccount, 'id'>;

/** Repo, installation and settings of a job, or null when the app was uninstalled since. */
export function loadRepo(prisma: PrismaClient, repoGithubId: number) {
  return prisma.repo.findUnique({
    where: { githubId: BigInt(repoGithubId) },
    include: { installation: true, settings: true },
  });
}
export type LoadedRepo = NonNullable<Awaited<ReturnType<typeof loadRepo>>>;

function prState(pr: PullRequestInfo): 'open' | 'merged' | 'closed' {
  if (pr.state === 'open') return 'open';
  return pr.merged ? 'merged' : 'closed';
}

/** Creates or refreshes the PR row from GitHub's current view of it. */
export function syncPullRequest(prisma: PrismaClient, repoId: string, pr: PullRequestInfo) {
  const fields = {
    githubId: BigInt(pr.githubId),
    title: pr.title,
    body: pr.body,
    author: pr.author,
    authorAvatarUrl: pr.authorAvatarUrl,
    baseRef: pr.baseRef,
    headRef: pr.headRef,
    headSha: pr.headSha,
    draft: pr.draft,
    state: prState(pr),
    url: pr.url,
    mergedAt: pr.mergedAt ? new Date(pr.mergedAt) : null,
    closedAt: pr.closedAt ? new Date(pr.closedAt) : null,
  };
  return prisma.pullRequest.upsert({
    where: { repoId_number: { repoId, number: pr.number } },
    create: { repoId, number: pr.number, openedAt: new Date(pr.createdAt), ...fields },
    update: fields,
  });
}

/** Queued reviews of other commits of the PR: replaced by the review of the head. */
export function supersededReviews(prisma: PrismaClient, pullRequestId: string, headSha: string) {
  return prisma.review.findMany({
    where: { pullRequestId, status: 'queued', headSha: { not: headSha } },
    select: { id: true, pullRequestId: true, headSha: true, checkRunId: true },
  });
}

/** The Review row of the head commit (created when the webhook did not create it). */
export function ensureReview(
  prisma: PrismaClient,
  input: { pullRequestId: string; repoId: string; headSha: string; model: string; trigger: ReviewTrigger },
) {
  return prisma.review.upsert({
    where: { pullRequestId_headSha: { pullRequestId: input.pullRequestId, headSha: input.headSha } },
    create: { ...input, status: 'queued' },
    update: {},
  });
}

/** Score of the PR's previous finished review, for "Previous review: 58 → 72". */
export async function previousScore(
  prisma: PrismaClient,
  pullRequestId: string,
  current: { id: string; status: string; score: number | null },
): Promise<number | null> {
  // "Review again" on the same commit: compare with that commit's last result.
  if (current.status === 'done' && current.score !== null) return current.score;
  const last = await prisma.review.findFirst({
    where: { pullRequestId, status: 'done', score: { not: null }, id: { not: current.id } },
    orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
    select: { score: true },
  });
  return last?.score ?? null;
}

/**
 * Head commit of the PR's latest finished review of another commit: the
 * files changed since then are reviewed first. Null on the first review.
 */
export async function lastReviewedSha(
  prisma: PrismaClient,
  pullRequestId: string,
  headSha: string,
): Promise<string | null> {
  const last = await prisma.review.findFirst({
    where: { pullRequestId, status: 'done', headSha: { not: headSha } },
    orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
    select: { headSha: true },
  });
  return last?.headSha ?? null;
}

/**
 * The run starts: `aiSource` is what pays for it (Revo's key, the account's key, the subscription).
 * A free run counts toward the account's free reviews from here (see `accountFreeReviewsUsed`).
 */
export function markRunning(
  prisma: Pick<PrismaClient, 'review'>,
  reviewId: string,
  trigger: ReviewTrigger,
  model: string,
  aiSource: AiSource,
) {
  return prisma.review.update({
    where: { id: reviewId },
    data: {
      status: 'running',
      trigger,
      model,
      aiSource,
      startedAt: new Date(),
      finishedAt: null,
      error: null,
      skipReason: null,
    },
  });
}

export function setCheckRunId(prisma: PrismaClient, reviewId: string, checkRunId: number) {
  return prisma.review.update({ where: { id: reviewId }, data: { checkRunId: BigInt(checkRunId) } });
}

/** Nothing was billed for a skipped run: `aiSource` goes back to null (an earlier run's payer is gone). */
export function markSkipped(
  prisma: PrismaClient,
  reviewId: string,
  reason: SkipReason,
  extra: { filesSkipped?: number; skippedFiles?: string[]; notes?: string[] } = {},
) {
  return prisma.review.update({
    where: { id: reviewId },
    data: {
      status: 'skipped',
      skipReason: reason,
      aiSource: null,
      error: null,
      filesReviewed: 0,
      ...extra,
      finishedAt: new Date(),
    },
  });
}

/** Usage billed by an attempt (tokens already spent count toward the budget). */
export type SpentUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};

/** The spend of a finished engine run. */
export function spentFrom(usage: SpentUsage): SpentUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
    costUsd: usage.costUsd,
  };
}

function spentIncrements(spent: SpentUsage) {
  return {
    inputTokens: { increment: spent.inputTokens },
    outputTokens: { increment: spent.outputTokens },
    cachedTokens: { increment: spent.cachedTokens },
    cacheWriteTokens: { increment: spent.cacheWriteTokens },
    costUsd: { increment: spent.costUsd },
  };
}

/**
 * A failed attempt: back to queued (BullMQ retries) or failed on the last one.
 * What the attempt already billed is added to the review and to the dated
 * cost ledger, so the monthly budget sees it (and the free-tier ledger, when
 * Revo's key paid).
 */
export async function markAttemptFailed(
  prisma: PrismaClient,
  reviewId: string,
  input: {
    repoId: string;
    account: BilledAccount;
    final: boolean;
    error: string;
    spent: SpentUsage | null;
    /** What paid for the attempt (unknown when it failed before choosing). */
    aiSource?: AiSource;
  },
) {
  const spent = input.spent;
  await prisma.$transaction([
    prisma.review.update({
      where: { id: reviewId },
      data: {
        status: input.final ? 'failed' : 'queued',
        error: input.error,
        ...(input.final ? { finishedAt: new Date() } : {}),
        ...(spent ? spentIncrements(spent) : {}),
      },
    }),
    prisma.reviewCost.createMany({
      data: spent
        ? reviewCostEntry({
            repoId: input.repoId,
            reviewId,
            costUsd: spent.costUsd,
            ...(input.aiSource ? { aiSource: input.aiSource } : {}),
          })
        : [],
    }),
    prisma.freeTierUsage.createMany({
      data: spent
        ? freeTierUsageEntry({ account: input.account, aiSource: input.aiSource, costUsd: spent.costUsd })
        : [],
    }),
  ]);
}

/** Inline comment id of each confirmed finding shown on GitHub, by finding index. */
export type PostedFindings = Map<number, number>;

function findingRow(
  reviewId: string,
  f: ReviewedFinding,
  verified: boolean,
  posted: PostedFindings,
): Prisma.FindingCreateManyInput {
  const commentId = verified ? posted.get(f.index) : undefined;
  return {
    reviewId,
    index: f.index,
    category: f.category,
    severity: f.severity,
    originalSeverity: f.originalSeverity,
    file: f.file,
    lineStart: f.lineStart,
    lineEnd: f.lineEnd,
    title: f.title,
    explanation: f.explanation,
    suggestion: f.suggestion,
    snippet: f.snippet,
    snippetStartLine: f.snippetStartLine,
    confidence: f.confidence,
    verified,
    rejectReason: verified ? null : f.reason,
    posted: commentId !== undefined,
    githubCommentId: commentId === undefined ? null : BigInt(commentId),
  };
}

/**
 * Saves a finished review (spec 7.9): the review row, its confirmed and
 * rejected findings (replacing those of an earlier run of the same commit),
 * and the PR's summary comment id. Tokens and cost add up across runs of the
 * same commit, and the run's cost is written to the dated ledger, so "Review
 * again" counts toward this month's budget whenever the commit was first reviewed.
 */
export async function saveDone(
  prisma: PrismaClient,
  input: {
    reviewId: string;
    repoId: string;
    account: BilledAccount;
    pullRequestId: string;
    outcome: DoneOutcome;
    posted: PostedFindings;
    summaryCommentId: number | null;
    aiSource: AiSource;
  },
) {
  const { outcome } = input;
  const now = new Date();
  await prisma.$transaction([
    prisma.finding.deleteMany({ where: { reviewId: input.reviewId } }),
    prisma.finding.createMany({
      data: [
        ...outcome.findings.map((f) => findingRow(input.reviewId, f, true, input.posted)),
        ...outcome.rejected.map((f) => findingRow(input.reviewId, f, false, input.posted)),
      ],
    }),
    prisma.review.update({
      where: { id: input.reviewId },
      data: {
        status: 'done',
        skipReason: null,
        error: null,
        score: outcome.score,
        label: outcome.label,
        passed: outcome.passed,
        model: outcome.model,
        ...spentIncrements(spentFrom(outcome.usage)),
        durationMs: outcome.durationMs,
        filesReviewed: outcome.filesReviewed,
        filesSkipped: outcome.filesSkipped,
        skippedFiles: outcome.skippedFiles.map((f) => f.path),
        notes: outcome.notes,
        aiSource: input.aiSource,
        finishedAt: now,
      },
    }),
    prisma.reviewCost.createMany({
      data: reviewCostEntry({
        repoId: input.repoId,
        reviewId: input.reviewId,
        costUsd: outcome.usage.costUsd,
        spentAt: now,
        aiSource: input.aiSource,
      }),
    }),
    prisma.freeTierUsage.createMany({
      data: freeTierUsageEntry({
        account: input.account,
        aiSource: input.aiSource,
        costUsd: outcome.usage.costUsd,
        spentAt: now,
      }),
    }),
    prisma.pullRequest.update({
      where: { id: input.pullRequestId },
      data: {
        lastReviewedAt: now,
        ...(input.summaryCommentId !== null ? { summaryCommentId: BigInt(input.summaryCommentId) } : {}),
      },
    }),
  ]);
}
