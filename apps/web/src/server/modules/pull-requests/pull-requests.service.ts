import 'server-only';
import { Prisma } from '@revo/db';
import {
  canRequestReview,
  DEFAULT_REPO_SETTINGS,
  isStaleInFlight,
  pageMeta,
  type Paginated,
  type PullRequestListQuery,
  type PullRequestSummaryDto,
} from '@revo/shared';
import { formatUsd } from '~/lib/format';
import type {
  PullRequestDetailDto,
  PullRequestFiltersDto,
  ReviewAgainBlock,
  ReviewAgainResultDto,
} from '~/types/pull-request';
import type { BudgetDto } from '~/types/repo';
import { prisma } from '../../config/prisma';
import { budgetReached, conflict, forbidden, notFound } from '../../http/errors';
import { queueReview } from '../github/review-start.service';
import { presentPullRequestSummary } from '../../presenters/pull-request.presenter';
import { repoUrl } from '../../presenters/repo.presenter';
import { presentReview } from '../../presenters/review.presenter';
import { budgetFor } from '../repos/budget';

/** `%` and `_` match literally in a search. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const ORDER_BY: Record<PullRequestListQuery['sort'], Record<PullRequestListQuery['dir'], Prisma.Sql>> = {
  lastReviewed: {
    desc: Prisma.sql`l.created_at DESC NULLS LAST, p."openedAt" DESC`,
    asc: Prisma.sql`l.created_at ASC NULLS LAST, p."openedAt" ASC`,
  },
  score: {
    desc: Prisma.sql`l.score DESC NULLS LAST, l.created_at DESC`,
    asc: Prisma.sql`l.score ASC NULLS LAST, l.created_at DESC`,
  },
  number: {
    desc: Prisma.sql`p.number DESC, p."repoId"`,
    asc: Prisma.sql`p.number ASC, p."repoId"`,
  },
};

/** WHERE conditions of the PR list; the latest review is `l`, its blocker count `c.blockers`. */
function listConditions(repoIds: string[], q: PullRequestListQuery): Prisma.Sql {
  const and: Prisma.Sql[] = [Prisma.sql`p."repoId" = ANY(${repoIds}::text[])`];
  if (q.repo?.length) and.push(Prisma.sql`p."repoId" = ANY(${q.repo}::text[])`);
  if (q.author?.length) and.push(Prisma.sql`p.author = ANY(${q.author}::text[])`);
  if (q.state?.length) and.push(Prisma.sql`p.state::text = ANY(${q.state}::text[])`);
  if (q.q) {
    const number = /^#?(\d{1,9})$/.exec(q.q)?.[1];
    and.push(
      number
        ? Prisma.sql`(p.number = ${Number(number)} OR p.title ILIKE ${likePattern(q.q)} ESCAPE '\\')`
        : Prisma.sql`p.title ILIKE ${likePattern(q.q)} ESCAPE '\\'`,
    );
  }
  if (q.scoreMin !== undefined) and.push(Prisma.sql`l.score >= ${q.scoreMin}`);
  if (q.scoreMax !== undefined) and.push(Prisma.sql`l.score <= ${q.scoreMax}`);
  if (q.hasBlockers === true) and.push(Prisma.sql`coalesce(c.blockers, 0) > 0`);
  if (q.hasBlockers === false) and.push(Prisma.sql`coalesce(c.blockers, 0) = 0`);
  return Prisma.join(and, ' AND ');
}

/** The latest review of each PR in scope (`l`) and its confirmed blockers (`c`). */
function latestJoin(repoIds: string[]): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN (
      SELECT DISTINCT ON (r."pullRequestId") r."pullRequestId" AS pr_id, r.id AS review_id,
        r.score, r.status, r."createdAt" AS created_at
      FROM "Review" r
      WHERE r."repoId" = ANY(${repoIds}::text[])
      ORDER BY r."pullRequestId", r."createdAt" DESC
    ) l ON l.pr_id = p.id
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS blockers FROM "Finding" f
      WHERE f."reviewId" = l.review_id AND f.verified AND f.severity = 'blocker' AND l.status = 'done'
    ) c ON true`;
}

const SUMMARY_INCLUDE = {
  repo: { select: { id: true, fullName: true } },
  reviews: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    include: { findings: { where: { verified: true }, select: { severity: true } } },
  },
} satisfies Prisma.PullRequestInclude;

function blockReason(block: ReviewAgainBlock, budget: BudgetDto): string | null {
  switch (block) {
    case 'budget':
      return `This repo reached its monthly budget of ${formatUsd(budget.budgetUsd)}.`;
    case 'disabled':
      return 'Reviews are turned off for this repo.';
    case 'not_open':
      return 'Only open pull requests are reviewed.';
    case 'suspended':
      return 'The GitHub App installation is suspended.';
    case 'in_progress':
      return 'A review is already queued or running.';
    case 'no_permission':
      return 'Starting a review needs write access to this repo on GitHub.';
    case null:
      return null;
  }
}

async function loadPullRequest(id: string, repoIds: string[]) {
  const pr = await prisma.pullRequest.findUnique({
    where: { id },
    include: {
      repo: { include: { settings: true, installation: true } },
      reviews: {
        orderBy: { createdAt: 'desc' },
        include: { findings: { where: { verified: true }, select: { severity: true } } },
      },
    },
  });
  // Spec 14: a PR in a repo the user cannot access does not exist for them.
  if (!pr || !repoIds.includes(pr.repoId)) throw notFound('Pull request');
  return pr;
}

type LoadedPullRequest = Awaited<ReturnType<typeof loadPullRequest>>;

/** The user's role on the PR's repo (they can see it, so the row exists unless access just changed). */
async function permissionOn(repoId: string, userId: string) {
  const row = await prisma.repoAccess.findUnique({
    where: { userId_repoId: { userId, repoId } },
    select: { permission: true },
  });
  return row?.permission ?? 'read';
}

function reviewAgainBlock(pr: LoadedPullRequest, budget: BudgetDto, canReview: boolean): ReviewAgainBlock {
  if (!canReview) return 'no_permission';
  // A queued or running review that has not moved for a long time lost its job: allow a new one.
  const latest = pr.reviews[0];
  if (latest && (latest.status === 'queued' || latest.status === 'running') && !isStaleInFlight(latest))
    return 'in_progress';
  if (pr.repo.installation.suspendedAt) return 'suspended';
  if (!pr.repo.enabled) return 'disabled';
  if (pr.state !== 'open') return 'not_open';
  if (budget.reached) return 'budget';
  return null;
}

export const pullRequestsService = {
  async list(repoIds: string[], q: PullRequestListQuery): Promise<Paginated<PullRequestSummaryDto>> {
    if (repoIds.length === 0) return { items: [], ...pageMeta(0, q.page, q.pageSize) };
    const where = listConditions(repoIds, q);
    const join = latestJoin(repoIds);
    const [countRows, pageRows] = await Promise.all([
      prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM "PullRequest" p ${join} WHERE ${where}`,
      prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM "PullRequest" p ${join} WHERE ${where}
        ORDER BY ${ORDER_BY[q.sort][q.dir]}
        LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    ]);
    const ids = pageRows.map((r) => r.id);
    const rows = await prisma.pullRequest.findMany({ where: { id: { in: ids } }, include: SUMMARY_INCLUDE });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      items: ids.flatMap((id) => {
        const row = byId.get(id);
        return row ? [presentPullRequestSummary(row)] : [];
      }),
      ...pageMeta(countRows[0]?.total ?? 0, q.page, q.pageSize),
    };
  },

  /** Repos and authors offered by the list filters. */
  async filters(repoIds: string[]): Promise<PullRequestFiltersDto> {
    const [repos, authors] = await Promise.all([
      prisma.repo.findMany({
        where: { id: { in: repoIds } },
        select: { id: true, fullName: true },
        orderBy: { fullName: 'asc' },
      }),
      prisma.pullRequest.findMany({
        where: { repoId: { in: repoIds } },
        distinct: ['author'],
        select: { author: true },
        orderBy: { author: 'asc' },
      }),
    ]);
    return { repos, authors: authors.map((a) => a.author) };
  },

  async detail(id: string, repoIds: string[], userId: string): Promise<PullRequestDetailDto> {
    const pr = await loadPullRequest(id, repoIds);
    const budget = await budgetFor(pr.repo);
    const block = reviewAgainBlock(pr, budget, canRequestReview(await permissionOn(pr.repoId, userId)));
    return {
      ...presentPullRequestSummary(pr),
      body: pr.body,
      headSha: pr.headSha,
      repo: {
        id: pr.repo.id,
        fullName: pr.repo.fullName,
        url: repoUrl(pr.repo.fullName),
        enabled: pr.repo.enabled,
      },
      reviews: pr.reviews.map(presentReview),
      budget,
      reviewAgain: { allowed: block === null, block, reason: blockReason(block, budget) },
    };
  },

  /**
   * "Review again" (spec 11.4): enqueues a manual review of the head commit,
   * unless the user lacks write access, the budget is reached, reviews are off
   * or the PR is not open.
   */
  async reviewAgain(id: string, repoIds: string[], userId: string): Promise<ReviewAgainResultDto> {
    const pr = await loadPullRequest(id, repoIds);
    const budget = await budgetFor(pr.repo);
    const block = reviewAgainBlock(pr, budget, canRequestReview(await permissionOn(pr.repoId, userId)));
    if (block === 'no_permission') throw forbidden(blockReason(block, budget) ?? undefined);
    if (block === 'budget') throw budgetReached({ spentUsd: budget.spentUsd, budgetUsd: budget.budgetUsd });
    if (block) throw conflict(blockReason(block, budget) ?? 'This pull request cannot be reviewed now.');
    if (!pr.headSha) throw conflict('The head commit of this pull request is not known yet.');

    // The Review row turns "queued" and the "Revo: reviewing…" check shows at
    // once; the worker re-runs this commit in the same row (spec 11.4).
    const { reviewId } = await queueReview(
      {
        pullRequest: { id: pr.id, number: pr.number, headSha: pr.headSha },
        repo: { id: pr.repo.id, githubId: pr.repo.githubId, fullName: pr.repo.fullName },
        installationGithubId: pr.repo.installation.githubId,
        model: pr.repo.settings?.model ?? DEFAULT_REPO_SETTINGS.model,
      },
      { trigger: 'manual', requestedByUserId: userId },
    );
    return { reviewId, queuedAt: new Date().toISOString() };
  },
};
