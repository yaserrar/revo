import type { PrismaClient } from '@revo/db';
import {
  listReviewThreads,
  reactionFeedback,
  type GithubClient,
  type RepoRef,
  type ReviewThreadState,
} from '@revo/github';

/** The PR whose GitHub feedback is read. */
export type FeedbackPull = { id: string; number: number };

export type FeedbackSync = {
  /** Every review thread of the PR, by the id of its first comment (Revo's inline comment). */
  threads: Map<number, ReviewThreadState>;
  /** GitHub feedback rows written or moved, and removed. */
  saved: number;
  removed: number;
};

/**
 * Reads the 👍/👎 on Revo's inline comments and the resolved state of their
 * threads, and stores them (no webhook exists for reactions):
 *
 * - each reaction becomes one feedback row (source `github`) on the newest
 *   finding shown by that comment (a comment follows its problem across
 *   reviews), kept when it moves so its date stays; a reaction taken back is
 *   removed. A Revo user who already answered in the dashboard is counted once.
 * - a thread a person resolved while the finding was still open marks it
 *   `dismissed` (a later review neither carries it nor posts it again); a
 *   thread opened again clears that.
 */
export async function syncPullRequestFeedback(
  prisma: PrismaClient,
  octokit: GithubClient,
  ref: RepoRef,
  pr: FeedbackPull,
  now = new Date(),
): Promise<FeedbackSync> {
  const threads = new Map((await listReviewThreads(octokit, ref, pr.number)).map((t) => [t.commentId, t]));
  const findings = await prisma.finding.findMany({
    where: { verified: true, githubCommentId: { not: null }, review: { pullRequestId: pr.id } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, githubCommentId: true, resolution: true },
  });
  // The newest finding of each comment: findings are written per review, newest first here.
  const latest = new Map<number, (typeof findings)[number]>();
  const byComment = new Map<number, string[]>();
  for (const f of findings) {
    const commentId = Number(f.githubCommentId);
    if (!latest.has(commentId)) latest.set(commentId, f);
    byComment.set(commentId, [...(byComment.get(commentId) ?? []), f.id]);
  }

  let saved = 0;
  let removed = 0;
  for (const [commentId, finding] of latest) {
    const thread = threads.get(commentId);
    const ids = byComment.get(commentId) ?? [];
    const wanted = thread ? reactionFeedback(thread) : [];
    const existing = await prisma.feedback.findMany({
      where: { findingId: { in: ids }, source: 'github' },
      select: { id: true, githubUserId: true, outcome: true, findingId: true },
    });
    // People who answered in the dashboard on this finding: their reaction would count them twice.
    const answered = new Set(
      (
        await prisma.feedback.findMany({
          where: { findingId: finding.id, source: 'dashboard', user: { isNot: null } },
          select: { user: { select: { githubId: true } } },
        })
      ).map((r) => Number(r.user!.githubId)),
    );
    const keep = wanted.filter((w) => !answered.has(w.userId));
    const keepIds = new Set(keep.map((w) => w.userId));

    const stale = existing.filter((e) => e.githubUserId === null || !keepIds.has(Number(e.githubUserId)));
    if (stale.length > 0) {
      await prisma.feedback.deleteMany({ where: { id: { in: stale.map((e) => e.id) } } });
      removed += stale.length;
    }
    for (const w of keep) {
      const row = existing.find((e) => Number(e.githubUserId) === w.userId);
      if (row && row.findingId === finding.id && row.outcome === w.outcome) continue;
      if (row) {
        await prisma.feedback.update({
          where: { id: row.id },
          data: { findingId: finding.id, outcome: w.outcome, githubLogin: w.login },
        });
      } else {
        await prisma.feedback.create({
          data: {
            findingId: finding.id,
            source: 'github',
            outcome: w.outcome,
            githubUserId: BigInt(w.userId),
            githubLogin: w.login,
          },
        });
      }
      saved++;
    }

    if (thread?.isResolved && finding.resolution === null) {
      await prisma.finding.update({
        where: { id: finding.id },
        data: { resolution: 'dismissed', resolvedAt: now },
      });
    } else if (thread && !thread.isResolved && finding.resolution === 'dismissed') {
      await prisma.finding.update({
        where: { id: finding.id },
        data: { resolution: null, resolvedAt: null },
      });
    }
  }

  await prisma.pullRequest.update({ where: { id: pr.id }, data: { feedbackSyncedAt: now } });
  return { threads, saved, removed };
}

/** How often the sweep runs, and how recently a PR's feedback must have been read to be skipped. */
export const FEEDBACK_SWEEP_EVERY_MS = 10 * 60_000;
/** PRs read per sweep; the rest wait for the next one. */
const SWEEP_BATCH = 50;
/** Closed and merged PRs are still read for this long (reactions often come after the merge). */
const CLOSED_GRACE_MS = 3 * 86_400_000;
/** PRs Revo has not reviewed for this long are left alone. */
const ACTIVE_WINDOW_MS = 30 * 86_400_000;

/**
 * PRs whose GitHub feedback is due: Revo posted inline comments, the PR was
 * reviewed in the last 30 days, is open or closed in the last 3 days, and was
 * not read in the last 10 minutes. Least recently read first.
 */
export function feedbackDue(prisma: PrismaClient, now = new Date()) {
  return prisma.pullRequest.findMany({
    where: {
      lastReviewedAt: { gte: new Date(now.getTime() - ACTIVE_WINDOW_MS) },
      OR: [{ state: 'open' }, { closedAt: { gte: new Date(now.getTime() - CLOSED_GRACE_MS) } }],
      AND: [
        {
          OR: [
            { feedbackSyncedAt: null },
            { feedbackSyncedAt: { lt: new Date(now.getTime() - FEEDBACK_SWEEP_EVERY_MS) } },
          ],
        },
      ],
      reviews: { some: { findings: { some: { posted: true } } } },
      repo: { installation: { suspendedAt: null } },
    },
    orderBy: [{ feedbackSyncedAt: { sort: 'asc', nulls: 'first' } }],
    take: SWEEP_BATCH,
    select: {
      id: true,
      number: true,
      repo: { select: { fullName: true, installation: { select: { githubId: true } } } },
    },
  });
}
