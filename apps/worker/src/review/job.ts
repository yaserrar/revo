import { UnrecoverableError } from 'bullmq';
import { lockFreeTierAccount, repoMonthSpendUsd, type PrismaClient } from '@revo/db';
import {
  closedCheck,
  compareCommits,
  createCheckRun,
  failedCheck,
  getPullRequest,
  githubErrorStatus,
  REEVALUATED_SKIP_REASONS,
  repoRef,
  resultCheck,
  reviewingCheck,
  skippedCheck,
  skipReasonFor,
  supersededCheck,
  updateCheckRun,
  upsertSummaryComment,
  type CheckPresentation,
  type GithubApp,
  type GithubClient,
  type PullRequestInfo,
  type RepoRef,
} from '@revo/github';
import { reviewChanges, type ReviewEngine, type ReviewSettingsInput } from '@revo/review';
import {
  CategorySchema,
  DEFAULT_REPO_SETTINGS,
  globError,
  ModelIdSchema,
  type AiSource,
  type ReviewJobPayload,
  type SkipReason,
} from '@revo/shared';
import type { Logger } from '../logger';
import { chooseEngine, type AiAccessConfig } from './ai-access';
import { describeFailure } from './failure';
import { codeSearcher, fetchChangedFiles, headFileReader } from './fetch';
import { postInlineComments, renderResult, summaryInput } from './publish';
import {
  ensureReview,
  lastReviewedSha,
  loadRepo,
  markAttemptFailed,
  markRunning,
  markSkipped,
  previousScore,
  saveDone,
  setCheckRunId,
  spentFrom,
  supersededReviews,
  syncPullRequest,
  type LoadedRepo,
  type SpentUsage,
} from './store';

export type ReviewDeps = {
  prisma: PrismaClient;
  github: GithubApp;
  /** Revo's own engine (REVO_ENGINE): the free tier and owner accounts. */
  engine: ReviewEngine;
  /** An engine for an account's own Anthropic API key (REVO_ENGINE=fake: the fake engine). */
  accountEngine: (apiKey: string) => ReviewEngine;
  /** The Claude subscription logged in on this machine; absent = such accounts use the free tier. */
  subscriptionEngine?: () => ReviewEngine;
  /** Free tier, owner accounts, subscription switch, saved-key decryption. */
  ai: AiAccessConfig;
  log: Logger;
  /** Dashboard base URL, for links in the comment and the check. */
  appUrl: string;
};

/** Which attempt this is: BullMQ's attemptsMade (finished attempts) and the max. */
export type JobAttempt = { attemptsMade: number; attempts: number };

export type ReviewJobResult =
  | { outcome: 'done'; reviewId: string; score: number; passed: boolean }
  | { outcome: 'skipped'; reviewId: string; reason: SkipReason }
  | { outcome: 'already-reviewed'; reviewId: string }
  | { outcome: 'closed' | 'gone' };

type Row = { id: string; pullRequestId: string; headSha: string; checkRunId: bigint | null };
const ROW_SELECT = { id: true, pullRequestId: true, headSha: true, checkRunId: true } as const;

/** Settings for the engine, tolerant of values no longer offered (falls back to defaults). */
function engineSettings(repo: LoadedRepo): ReviewSettingsInput & {
  inlineComments: boolean;
  reviewDrafts: boolean;
  reviewBots: boolean;
  monthlyBudgetUsd: number;
} {
  const s = repo.settings;
  if (!s) return DEFAULT_REPO_SETTINGS;
  const model = ModelIdSchema.safeParse(s.model);
  const categories = s.categories.flatMap((c) => {
    const parsed = CategorySchema.safeParse(c);
    return parsed.success ? [parsed.data] : [];
  });
  return {
    model: model.success ? model.data : DEFAULT_REPO_SETTINGS.model,
    categories: categories.length ? categories : DEFAULT_REPO_SETTINGS.categories,
    ignoreGlobs: s.ignoreGlobs,
    threshold: s.threshold,
    maxFindings: s.maxFindings,
    instructions: s.instructions,
    inlineComments: s.inlineComments,
    reviewDrafts: s.reviewDrafts,
    reviewBots: s.reviewBots,
    monthlyBudgetUsd: Number(s.monthlyBudgetUsd),
  };
}

/**
 * Runs one review job (spec 7): sync the PR from GitHub, review its current
 * head (older queued commits are superseded), apply the skip rules, run the
 * engine, post the summary comment, the inline comments and the check, then
 * save everything. Failed attempts are retried by BullMQ; the last one marks
 * the review failed with a neutral "Revo couldn't review this PR" check.
 */
export async function runReviewJob(
  payload: ReviewJobPayload,
  attempt: JobAttempt,
  deps: ReviewDeps,
): Promise<ReviewJobResult> {
  const { prisma, log } = deps;
  const repo = await loadRepo(prisma, payload.repoGithubId);
  if (!repo || repo.installation.suspendedAt) {
    log.info(
      { repo: payload.repoFullName },
      'repo no longer installed or installation suspended; job dropped',
    );
    return { outcome: 'gone' };
  }
  const ref = repoRef(repo.fullName);
  const settings = engineSettings(repo);
  const invalidGlobs = settings.ignoreGlobs.filter((g) => globError(g) !== null);
  if (invalidGlobs.length > 0)
    log.warn({ repo: repo.fullName, count: invalidGlobs.length }, 'invalid ignore patterns left out');
  let octokit: GithubClient | null = null;
  let row: Row | null = null;
  // Money billed by the engine in this attempt: counted even when a later GitHub call fails.
  let spent: SpentUsage | null = null;
  // What pays for this attempt, the model it runs, and whose own key it uses (for a refused key).
  let aiSource: AiSource | undefined;
  let runModel: string = settings.model;
  let accountKeyOf: string | undefined;

  const prUrl = (id: string) => `${deps.appUrl.replace(/\/$/, '')}/prs/${id}`;
  const check = async (target: Row, presentation: CheckPresentation) => {
    if (!octokit) return;
    await showCheck(octokit, ref, target, presentation, prUrl(target.pullRequestId), prisma);
  };

  try {
    octokit = await deps.github.installation(Number(repo.installation.githubId));
    const app = await deps.github.identity();
    let live: PullRequestInfo;
    try {
      live = await getPullRequest(octokit, ref, payload.prNumber);
    } catch (err) {
      if (githubErrorStatus(err) !== 404) throw err;
      log.info(
        { repo: repo.fullName, pr: payload.prNumber },
        'pull request not found on GitHub; job dropped',
      );
      return { outcome: 'gone' };
    }
    const pr = await syncPullRequest(prisma, repo.id, live);

    // A push replaced these commits before they were reviewed (spec 3.3: review the latest).
    for (const old of await supersededReviews(prisma, pr.id, live.headSha)) {
      await check(old, supersededCheck()).catch((err: unknown) =>
        log.warn({ err: errorText(err) }, 'could not close a superseded check'),
      );
      await prisma.review.delete({ where: { id: old.id } });
    }

    if (live.state === 'closed') {
      const queued = await prisma.review.findFirst({
        where: { pullRequestId: pr.id, headSha: live.headSha, status: 'queued' },
        select: ROW_SELECT,
      });
      if (queued) {
        await check(queued, closedCheck()).catch(() => undefined);
        await prisma.review.delete({ where: { id: queued.id } });
      }
      return { outcome: 'closed' };
    }

    const review = await ensureReview(prisma, {
      pullRequestId: pr.id,
      repoId: repo.id,
      headSha: live.headSha,
      model: settings.model,
      trigger: payload.trigger,
    });
    row = review;
    // Spec 6: one automatic review per (repo, PR, head SHA).
    const finished =
      review.status === 'done' ||
      review.status === 'failed' ||
      (review.status === 'skipped' &&
        review.skipReason !== null &&
        !REEVALUATED_SKIP_REASONS.includes(review.skipReason));
    if (payload.trigger === 'auto' && finished) return { outcome: 'already-reviewed', reviewId: review.id };

    // Skip rules again at run time: settings, draft state or budget may have changed since the webhook.
    // A manual "Review again" overrides the draft and bot rules, never the switch or the budget.
    const manual = payload.trigger === 'manual';
    const reason: SkipReason | null = skipReasonFor({
      repoEnabled: repo.enabled,
      reviewDrafts: manual || settings.reviewDrafts,
      reviewBots: manual || settings.reviewBots,
      draft: live.draft,
      authorLogin: live.author,
      authorType: live.authorType,
      monthSpentUsd: await repoMonthSpendUsd(prisma, repo.id),
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
    });
    if (reason) {
      await markSkipped(prisma, review.id, reason);
      await check(review, skippedCheck(reason));
      log.info({ repo: repo.fullName, pr: live.number, reason }, 'review skipped');
      return { outcome: 'skipped', reviewId: review.id, reason };
    }

    // Who pays: the account's key, the local subscription, or Revo's key within the free tier
    // (a manual "Review again" counts and is refused the same way). The free-tier count and the
    // `running` mark that reserves the run happen under one per-account lock, so parallel jobs of
    // one account cannot both take its last free review.
    const before = { id: review.id, status: review.status, score: review.score };
    const choice = await prisma.$transaction(async (tx) => {
      await lockFreeTierAccount(tx, repo.installation.id);
      const decided = await chooseEngine(
        repo.installation,
        settings.model,
        { ...deps, prisma: tx },
        { reviewId: review.id },
      );
      if (decided.kind === 'run')
        await markRunning(tx, review.id, payload.trigger, decided.model, decided.aiSource);
      return decided;
    });
    if (choice.kind === 'skip') {
      await markSkipped(prisma, review.id, choice.reason);
      await check(review, skippedCheck(choice.reason, choice.detail));
      log.info({ repo: repo.fullName, pr: live.number, reason: choice.reason }, 'review skipped');
      return { outcome: 'skipped', reviewId: review.id, reason: choice.reason };
    }
    aiSource = choice.aiSource;
    runModel = choice.model;
    if (choice.aiSource === 'account') accountKeyOf = repo.installation.accountLogin;
    // A finished review's check is completed and cannot go back to in progress: a re-run gets a new one.
    if (before.status !== 'queued' && before.status !== 'running') review.checkRunId = null;
    await check(review, reviewingCheck());

    // What the pushes since the last review changed: reviewed first, with their own diff.
    const since = await lastReviewedSha(prisma, pr.id, live.headSha);
    const recent = since
      ? await compareCommits(octokit, ref, since, live.headSha).catch((err: unknown) => {
          log.warn(
            { pr: live.number, err: errorText(err) },
            'could not compare with the last reviewed commit',
          );
          return null;
        })
      : null;
    const files = await fetchChangedFiles(
      octokit,
      ref,
      live.number,
      live.headSha,
      settings.ignoreGlobs,
      recent,
    );
    const outcome = await reviewChanges({
      pr: { title: live.title, body: live.body },
      files,
      related: [],
      settings: { ...settings, model: choice.model },
      engine: choice.engine,
      readFile: headFileReader(octokit, ref, live.headSha),
      searchUsages: codeSearcher(octokit, ref),
    });
    if (outcome.status === 'done') spent = spentFrom(outcome.usage);
    // Why the model differs from the repo's choice comes first in the notes.
    outcome.notes = [...choice.notes, ...outcome.notes];

    if (outcome.status === 'skipped') {
      await markSkipped(prisma, review.id, outcome.skipReason, {
        filesSkipped: outcome.filesSkipped,
        skippedFiles: outcome.skippedFiles.map((f) => f.path),
        notes: outcome.notes,
      });
      await check(review, skippedCheck(outcome.skipReason));
      log.info({ repo: repo.fullName, pr: live.number, reason: outcome.skipReason }, 'review skipped');
      return { outcome: 'skipped', reviewId: review.id, reason: outcome.skipReason };
    }

    // Inline comments first, so the summary can link each finding to its thread.
    const posted = settings.inlineComments
      ? await postInlineComments(octokit, ref, live.number, live.headSha, outcome, files, app, log)
      : new Map<number, number>();
    const rendered = renderResult(
      summaryInput(outcome, {
        previousScore: await previousScore(prisma, pr.id, before),
        settings,
        trigger: payload.trigger,
        files,
        posted,
        prNumber: live.number,
        headSha: live.headSha,
        repoFullName: repo.fullName,
        dashboardUrl: prUrl(pr.id),
        settingsUrl: `${deps.appUrl.replace(/\/$/, '')}/repos/${repo.id}/settings`,
        paidBy: choice.paidBy,
      }),
    );
    const summaryCommentId = await upsertSummaryComment(
      octokit,
      ref,
      live.number,
      rendered.comment,
      pr.summaryCommentId === null ? null : Number(pr.summaryCommentId),
      app,
    );
    await check(
      review,
      resultCheck({
        score: outcome.score,
        label: outcome.label,
        passed: outcome.passed,
        summary: rendered.checkSummary,
        partialCoverage: rendered.partialCoverage,
      }),
    );
    await saveDone(prisma, {
      reviewId: review.id,
      repoId: repo.id,
      account: repo.installation,
      pullRequestId: pr.id,
      outcome,
      posted,
      summaryCommentId,
      aiSource: choice.aiSource,
    });
    spent = null;
    log.info(
      {
        repo: repo.fullName,
        pr: live.number,
        sha: live.headSha.slice(0, 7),
        score: outcome.score,
        findings: outcome.findings.length,
        rejected: outcome.rejected.length,
        inline: posted.size,
        costUsd: outcome.usage.costUsd,
        aiSource: choice.aiSource,
        durationMs: outcome.durationMs,
      },
      'review done',
    );
    return { outcome: 'done', reviewId: review.id, score: outcome.score, passed: outcome.passed };
  } catch (err) {
    const failure = describeFailure(err, runModel, {
      ...(accountKeyOf ? { accountKeyOf } : {}),
      subscription: aiSource === 'subscription',
    });
    const final = !failure.retryable || attempt.attemptsMade + 1 >= attempt.attempts;
    log.error(
      {
        repo: repo.fullName,
        pr: payload.prNumber,
        attempt: attempt.attemptsMade + 1,
        final,
        err: errorText(err),
      },
      'review attempt failed',
    );
    // The row of this commit, even when GitHub failed before the PR was synced.
    const failedRow = row ?? (await findRow(prisma, repo.id, payload.prNumber, payload.headSha));
    if (failedRow) {
      await markAttemptFailed(prisma, failedRow.id, {
        repoId: repo.id,
        account: repo.installation,
        final,
        error: failure.message,
        spent: failure.spent ?? spent,
        ...(aiSource ? { aiSource } : {}),
      });
      if (final) {
        octokit ??= await deps.github.installation(Number(repo.installation.githubId)).catch(() => null);
        await check(failedRow, failedCheck()).catch((checkErr: unknown) =>
          log.warn({ err: errorText(checkErr) }, 'could not complete the check of a failed review'),
        );
      }
    }
    if (!failure.retryable) throw new UnrecoverableError(failure.message);
    throw err;
  }
}

function findRow(prisma: PrismaClient, repoId: string, prNumber: number, headSha: string) {
  return prisma.review.findFirst({
    where: { repoId, headSha, pullRequest: { number: prNumber } },
    select: ROW_SELECT,
  });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Shows a presentation on the review's check run: updates it, or creates one
 * when the review has none (or GitHub lost it), and remembers its id.
 */
async function showCheck(
  octokit: GithubClient,
  ref: RepoRef,
  row: Row,
  presentation: CheckPresentation,
  detailsUrl: string,
  prisma: PrismaClient,
): Promise<void> {
  if (row.checkRunId !== null) {
    try {
      await updateCheckRun(octokit, ref, Number(row.checkRunId), presentation, detailsUrl);
      return;
    } catch (err) {
      if (githubErrorStatus(err) !== 404) throw err;
    }
  }
  const id = await createCheckRun(octokit, ref, row.headSha, presentation, detailsUrl);
  row.checkRunId = BigInt(id);
  await setCheckRunId(prisma, row.id, id);
}
