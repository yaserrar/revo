import 'server-only';
import {
  createCheckRun,
  failedCheck,
  repoRef,
  reviewingCheck,
  skippedCheck,
  updateCheckRun,
  type CheckPresentation,
} from '@revo/github';
import type { ReviewTrigger, SkipReason } from '@revo/shared';
import { logger } from '~/server/config/logger';
import { prisma } from '~/server/config/prisma';
import { enqueueReview } from '~/server/queue/review-queue';
import { dashboardPrUrl, githubApp } from './github-app';

/** What is needed to start (or skip) a review of a PR's head commit. */
export type ReviewTarget = {
  pullRequest: { id: string; number: number; headSha: string };
  repo: { id: string; githubId: bigint; fullName: string };
  installationGithubId: bigint;
  model: string;
};

/**
 * Shows a presentation on the review's "Revo" check run: updates the run the
 * review already has, or creates one and stores its id (a completed check run
 * cannot go back to in progress, so each queued or skipped review gets its
 * own). Best effort: GitHub being down must not fail the webhook; the worker
 * creates the check when it starts.
 */
async function showCheck(
  target: ReviewTarget,
  reviewId: string,
  presentation: CheckPresentation,
  existingCheckRunId: bigint | null = null,
): Promise<void> {
  const app = githubApp();
  if (!app) {
    logger.warn({ repo: target.repo.fullName }, 'GitHub App not configured; check run not created');
    return;
  }
  try {
    const octokit = await app.installation(Number(target.installationGithubId));
    const ref = repoRef(target.repo.fullName);
    const detailsUrl = dashboardPrUrl(target.pullRequest.id);
    if (existingCheckRunId !== null) {
      await updateCheckRun(octokit, ref, Number(existingCheckRunId), presentation, detailsUrl);
      return;
    }
    const checkRunId = await createCheckRun(
      octokit,
      ref,
      target.pullRequest.headSha,
      presentation,
      detailsUrl,
    );
    await prisma.review.update({ where: { id: reviewId }, data: { checkRunId: BigInt(checkRunId) } });
  } catch (err) {
    logger.warn(
      {
        repo: target.repo.fullName,
        pr: target.pullRequest.number,
        err: err instanceof Error ? err.message : String(err),
      },
      'could not show the check run',
    );
  }
}

/** Error stored on a review whose job could not be added: a redelivered webhook queues it again. */
export const ENQUEUE_FAILED_ERROR = 'The review could not be queued.';

/**
 * Queues a review of the PR's head commit: marks the Review row queued, shows
 * "Revo: reviewing…" on the commit right away (spec 3.2), then adds the job
 * (debounced for automatic reviews). The row and the check exist before the
 * job, so a worker that starts at once finds both. If the job cannot be
 * added (Redis down or too slow), the row is marked failed and the check
 * completed as failed, so nothing stays "reviewing…" and "Review again" works.
 */
export async function queueReview(
  target: ReviewTarget,
  opts: { trigger: ReviewTrigger; deliveryId?: string; requestedByUserId?: string },
): Promise<{ reviewId: string }> {
  const reset = {
    status: 'queued' as const,
    trigger: opts.trigger,
    skipReason: null,
    error: null,
    checkRunId: null,
    startedAt: null,
    finishedAt: null,
  };
  const review = await prisma.review.upsert({
    where: {
      pullRequestId_headSha: { pullRequestId: target.pullRequest.id, headSha: target.pullRequest.headSha },
    },
    create: {
      pullRequestId: target.pullRequest.id,
      repoId: target.repo.id,
      headSha: target.pullRequest.headSha,
      model: target.model,
      ...reset,
    },
    update: { ...reset, model: target.model },
  });
  await showCheck(target, review.id, reviewingCheck());
  try {
    await enqueueReview({
      installationGithubId: Number(target.installationGithubId),
      repoGithubId: Number(target.repo.githubId),
      repoFullName: target.repo.fullName,
      prNumber: target.pullRequest.number,
      headSha: target.pullRequest.headSha,
      trigger: opts.trigger,
      ...(opts.requestedByUserId ? { requestedByUserId: opts.requestedByUserId } : {}),
      ...(opts.deliveryId ? { deliveryId: opts.deliveryId } : {}),
      enqueuedAt: new Date().toISOString(),
    });
  } catch (err) {
    const failed = await prisma.review.update({
      where: { id: review.id },
      data: { status: 'failed', error: ENQUEUE_FAILED_ERROR, finishedAt: new Date() },
      select: { checkRunId: true },
    });
    await showCheck(target, review.id, failedCheck(), failed.checkRunId);
    throw err;
  }
  return { reviewId: review.id };
}

/** Records a skipped review (neutral check with the reason, spec 6 and 11.6). */
export async function skipReview(target: ReviewTarget, reason: SkipReason): Promise<{ reviewId: string }> {
  const where = {
    pullRequestId_headSha: { pullRequestId: target.pullRequest.id, headSha: target.pullRequest.headSha },
  };
  const now = new Date();
  const data = {
    status: 'skipped' as const,
    skipReason: reason,
    trigger: 'auto' as const,
    model: target.model,
    error: null,
    checkRunId: null,
    startedAt: null,
    finishedAt: now,
  };
  const review = await prisma.review.upsert({
    where,
    create: {
      pullRequestId: target.pullRequest.id,
      repoId: target.repo.id,
      headSha: target.pullRequest.headSha,
      ...data,
    },
    update: data,
  });
  await showCheck(target, review.id, skippedCheck(reason));
  logger.info({ repo: target.repo.fullName, pr: target.pullRequest.number, reason }, 'review skipped');
  return { reviewId: review.id };
}
