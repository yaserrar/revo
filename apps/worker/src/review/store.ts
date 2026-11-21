import { reviewCostEntry, type PrismaClient, type Prisma } from '@revo/db';
import type { PullRequestInfo } from '@revo/github';
import type { ReviewedFinding, ReviewOutcome } from '@revo/review';
import type { ReviewTrigger, SkipReason } from '@revo/shared';

type DoneOutcome = Extract<ReviewOutcome, { status: 'done' }>;

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

export function markRunning(prisma: PrismaClient, reviewId: string, trigger: ReviewTrigger, model: string) {
  return prisma.review.update({
    where: { id: reviewId },
    data: {
      status: 'running',
      trigger,
      model,
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
 * cost ledger, so the monthly budget sees it.
 */
export async function markAttemptFailed(
  prisma: PrismaClient,
  reviewId: string,
  input: { repoId: string; final: boolean; error: string; spent: SpentUsage | null },
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
      data: spent ? reviewCostEntry({ repoId: input.repoId, reviewId, costUsd: spent.costUsd }) : [],
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
    pullRequestId: string;
    outcome: DoneOutcome;
    posted: PostedFindings;
    summaryCommentId: number | null;
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
        finishedAt: now,
      },
    }),
    prisma.reviewCost.createMany({
      data: reviewCostEntry({
        repoId: input.repoId,
        reviewId: input.reviewId,
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
