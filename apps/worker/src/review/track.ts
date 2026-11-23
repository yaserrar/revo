import type { PrismaClient } from '@revo/db';
import {
  repoRef,
  resolveReviewThread,
  type GithubApp,
  type GithubClient,
  type ReviewThreadState,
} from '@revo/github';
import {
  locateFinding,
  type ChangedFile,
  type FileReader,
  type LocatedPrior,
  type PriorFinding,
} from '@revo/review';
import { CategorySchema } from '@revo/shared';
import type { Logger } from '../logger';
import { feedbackDue, syncPullRequestFeedback } from './feedback';

const PRIOR_INCLUDE = { feedbacks: { select: { outcome: true } } } as const;

/**
 * What the next review checks again: the open problems of the PR's latest
 * finished review, plus every problem a person dismissed on this PR (found
 * again, it is rejected instead of posted). A problem is dismissed when a
 * person resolved its thread unfixed, or when more people marked it wrong
 * than useful (dashboard and 👍/👎 on GitHub). Fixed ones are left out.
 */
export async function loadPriorFindings(
  prisma: PrismaClient,
  pullRequestId: string,
): Promise<PriorFinding[]> {
  const last = await prisma.review.findFirst({
    where: { pullRequestId, status: 'done' },
    orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      headSha: true,
      findings: {
        where: { verified: true, resolution: null },
        orderBy: { index: 'asc' },
        include: PRIOR_INCLUDE,
      },
    },
  });
  if (!last) return [];
  const history = await prisma.finding.findMany({
    where: {
      verified: true,
      review: { pullRequestId, status: 'done' },
      OR: [{ resolution: 'dismissed' }, { feedbacks: { some: { outcome: 'wrong' } } }],
    },
    orderBy: { createdAt: 'desc' },
    include: { ...PRIOR_INCLUDE, review: { select: { headSha: true } } },
  });

  type Row = (typeof last.findings)[number];
  const toPrior = (f: Row, reviewSha: string): PriorFinding | null => {
    const category = CategorySchema.safeParse(f.category);
    if (!category.success) return null;
    const useful = f.feedbacks.filter((x) => x.outcome === 'useful').length;
    const wrong = f.feedbacks.length - useful;
    return {
      id: f.id,
      category: category.data,
      severity: f.severity,
      originalSeverity: f.originalSeverity,
      file: f.file,
      lineStart: f.lineStart,
      lineEnd: f.lineEnd,
      title: f.title,
      explanation: f.explanation,
      suggestion: f.suggestion,
      ...(f.replacement !== null ? { replacement: f.replacement } : {}),
      confidence: f.confidence,
      snippet: f.snippet,
      snippetStartLine: f.snippetStartLine,
      githubCommentId: f.githubCommentId === null ? null : Number(f.githubCommentId),
      openSince: f.openSince ?? reviewSha,
      dismissed: f.resolution === 'dismissed' || wrong > useful,
    };
  };

  // One entry per problem (file, category, title): a dismissal anywhere on the PR wins.
  const byProblem = new Map<string, PriorFinding>();
  const key = (p: PriorFinding) => [p.file, p.category, p.title.trim().toLowerCase()].join('\n');
  for (const f of history) {
    const prior = toPrior(f, f.review.headSha);
    if (prior?.dismissed && !byProblem.has(key(prior))) byProblem.set(key(prior), prior);
  }
  for (const f of last.findings) {
    const prior = toPrior(f, last.headSha);
    if (prior && !byProblem.has(key(prior))) byProblem.set(key(prior), prior);
  }
  return [...byProblem.values()];
}

/**
 * Where each prior finding's flagged lines are in the files at the new head
 * (changed files' content when fetched, otherwise read from GitHub; a file
 * that is gone fixes its findings). Returns the files read, for snippets.
 */
export async function locatePriors(
  priors: readonly PriorFinding[],
  files: readonly ChangedFile[],
  readFile: FileReader,
): Promise<{ located: LocatedPrior[]; contents: Map<string, string | null> }> {
  const contents = new Map<string, string | null>();
  for (const path of new Set(priors.map((p) => p.file))) {
    const changed = files.find((f) => f.path === path);
    contents.set(path, changed?.newContent ?? (changed?.status === 'removed' ? null : await readFile(path)));
  }
  return {
    located: priors.map((p) => ({ ...p, located: locateFinding(p, contents.get(p.file) ?? null) })),
    contents,
  };
}

/** Resolves the threads Revo opened for findings the new commits fixed. Returns how many were resolved. */
export async function resolveFixedThreads(
  octokit: GithubClient,
  fixed: readonly { githubCommentId: number | null }[],
  threads: ReadonlyMap<number, ReviewThreadState>,
  log: Logger,
): Promise<number> {
  let resolved = 0;
  for (const f of fixed) {
    const thread = f.githubCommentId === null ? undefined : threads.get(f.githubCommentId);
    if (!thread || thread.isResolved) continue;
    try {
      await resolveReviewThread(octokit, thread.threadId);
      resolved++;
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'could not resolve a fixed thread');
    }
  }
  return resolved;
}

/**
 * The periodic sweep: reads GitHub feedback for the PRs that are due (see
 * `feedbackDue`). A PR that fails is skipped until the next sweep.
 */
export async function sweepFeedback(deps: { prisma: PrismaClient; github: GithubApp; log: Logger }) {
  const due = await feedbackDue(deps.prisma);
  let synced = 0;
  for (const pr of due) {
    try {
      const octokit = await deps.github.installation(Number(pr.repo.installation.githubId));
      await syncPullRequestFeedback(deps.prisma, octokit, repoRef(pr.repo.fullName), pr);
      synced++;
    } catch (err) {
      deps.log.warn(
        { repo: pr.repo.fullName, pr: pr.number, err: err instanceof Error ? err.message : String(err) },
        'could not read GitHub feedback',
      );
      await deps.prisma.pullRequest
        .update({ where: { id: pr.id }, data: { feedbackSyncedAt: new Date() } })
        .catch(() => undefined);
    }
  }
  return { due: due.length, synced };
}
