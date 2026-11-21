import 'server-only';
import { repoMonthSpendUsd } from '@revo/db';
import { isReviewAction, REEVALUATED_SKIP_REASONS, skipReasonFor, type PullRequestEvent } from '@revo/github';
import { DEFAULT_REPO_SETTINGS, isStaleInFlight } from '@revo/shared';
import { logger } from '~/server/config/logger';
import { prisma } from '~/server/config/prisma';
import { upsertInstallation, upsertRepos } from './installations.service';
import { ENQUEUE_FAILED_ERROR, queueReview, skipReview, type ReviewTarget } from './review-start.service';

export type PullRequestOutcome =
  'ignored' | 'suspended' | 'updated' | 'closed' | 'duplicate' | 'queued' | `skipped:${string}`;

function prState(pr: PullRequestEvent['pull_request']): 'open' | 'merged' | 'closed' {
  if (pr.state === 'open') return 'open';
  return pr.merged || pr.merged_at ? 'merged' : 'closed';
}

/** Installation and repo rows for the event, created when the install event was missed. */
async function ensureRepo(event: PullRequestEvent) {
  const existing = await prisma.repo.findUnique({
    where: { githubId: BigInt(event.repository.id) },
    include: { installation: true, settings: true },
  });
  if (existing && existing.fullName === event.repository.full_name && existing.settings) return existing;
  const installation =
    existing?.installation ??
    (await upsertInstallation({ id: event.installation.id, account: event.repository.owner }));
  await upsertRepos(installation.id, [event.repository]);
  return prisma.repo.findUniqueOrThrow({
    where: { githubId: BigInt(event.repository.id) },
    include: { installation: true, settings: true },
  });
}

/**
 * `pull_request` events (spec 6). Every action refreshes the PR row; opened,
 * synchronize, reopened and ready_for_review start a review of the head commit
 * (or record why it is skipped); closed marks it merged or closed, no review.
 */
export async function handlePullRequestEvent(
  event: PullRequestEvent,
  deliveryId: string,
): Promise<PullRequestOutcome> {
  const repo = await ensureRepo(event);
  if (repo.installation.suspendedAt) return 'suspended';

  const p = event.pull_request;
  const state = prState(p);
  const fields = {
    githubId: BigInt(p.id),
    title: p.title,
    body: p.body ?? '',
    author: p.user.login,
    authorAvatarUrl: p.user.avatar_url ?? null,
    baseRef: p.base.ref,
    headRef: p.head.ref,
    headSha: p.head.sha,
    draft: p.draft,
    state,
    url: p.html_url,
    mergedAt: p.merged_at ? new Date(p.merged_at) : null,
    closedAt: p.closed_at ? new Date(p.closed_at) : null,
  };
  const pullRequest = await prisma.pullRequest.upsert({
    where: { repoId_number: { repoId: repo.id, number: p.number } },
    create: { repoId: repo.id, number: p.number, openedAt: new Date(p.created_at), ...fields },
    update: fields,
  });

  if (event.action === 'closed') {
    logger.info({ repo: repo.fullName, pr: p.number, state }, 'pull request closed');
    return 'closed';
  }
  if (!isReviewAction(event.action) || state !== 'open')
    return event.action === 'edited' ? 'updated' : 'ignored';

  // Spec 6: one review per (repo, PR, head SHA). Re-evaluated: skips that may no longer apply,
  // a review whose job could not be queued, and one stuck in queued/running (its job was lost).
  const existing = await prisma.review.findUnique({
    where: { pullRequestId_headSha: { pullRequestId: pullRequest.id, headSha: p.head.sha } },
    select: { status: true, skipReason: true, error: true, updatedAt: true },
  });
  const reevaluate =
    (existing?.status === 'skipped' &&
      existing.skipReason !== null &&
      REEVALUATED_SKIP_REASONS.includes(existing.skipReason)) ||
    (existing?.status === 'failed' && existing.error === ENQUEUE_FAILED_ERROR) ||
    (existing !== null && isStaleInFlight(existing));
  if (existing && !reevaluate) return 'duplicate';

  const settings = repo.settings ?? DEFAULT_REPO_SETTINGS;
  const reason = skipReasonFor({
    repoEnabled: repo.enabled,
    reviewDrafts: settings.reviewDrafts,
    reviewBots: settings.reviewBots,
    draft: p.draft,
    authorLogin: p.user.login,
    authorType: p.user.type,
    monthSpentUsd: await repoMonthSpendUsd(prisma, repo.id),
    monthlyBudgetUsd: Number(settings.monthlyBudgetUsd),
  });
  if (reason && existing?.skipReason === reason) return 'duplicate';

  const target: ReviewTarget = {
    pullRequest: { id: pullRequest.id, number: pullRequest.number, headSha: p.head.sha },
    repo: { id: repo.id, githubId: repo.githubId, fullName: repo.fullName },
    installationGithubId: repo.installation.githubId,
    model: settings.model,
  };
  if (reason) {
    await skipReview(target, reason);
    return `skipped:${reason}`;
  }
  await queueReview(target, { trigger: 'auto', deliveryId });
  logger.info({ repo: repo.fullName, pr: p.number, sha: p.head.sha.slice(0, 7) }, 'review queued');
  return 'queued';
}
