import {
  createInlineReview,
  findingKey,
  githubErrorStatus,
  inlineTarget,
  isInlineSeverity,
  listPostedFindingComments,
  partialCoverage,
  renderCheckSummary,
  renderInlineComment,
  renderSummaryComment,
  type AppIdentity,
  type GithubClient,
  type InlineComment,
  type RepoRef,
  type SummaryFixed,
  type SummaryInput,
} from '@revo/github';
import type { ChangedFile, ReviewOutcome, ReviewSettingsInput } from '@revo/review';
import { modelName, type ReviewTrigger } from '@revo/shared';
import type { Logger } from '../logger';

type DoneOutcome = Extract<ReviewOutcome, { status: 'done' }>;

export type SummaryContext = {
  previousScore: number | null;
  settings: Pick<ReviewSettingsInput, 'threshold' | 'maxFindings' | 'categories'>;
  trigger: ReviewTrigger;
  /** Every changed file given to the review (reviewed = these minus `outcome.skippedFiles`). */
  files: ChangedFile[];
  /** Inline comment id of each confirmed finding shown on its line, by finding index. */
  posted: Map<number, number>;
  prNumber: number;
  headSha: string;
  repoFullName: string;
  dashboardUrl: string;
  settingsUrl: string;
  /** Who paid, after the model in the footer (the free tier's usage). */
  paidBy?: string | null;
  /** Problems of the previous review the new commits fixed. */
  fixed?: readonly FixedFinding[];
};

/** A prior finding the new commits fixed, as the summary lists it. */
export type FixedFinding = Pick<
  SummaryFixed,
  'category' | 'severity' | 'file' | 'lineStart' | 'lineEnd' | 'title'
> & { githubCommentId: number | null };

/** Shown instead of a model name when the deterministic offline engine ran (tests, demos). */
export const FAKE_ENGINE_NAME = 'Offline test engine (no AI)';

export function summaryInput(outcome: DoneOutcome, ctx: SummaryContext): SummaryInput {
  const skipped = new Set(outcome.skippedFiles.map((f) => f.path));
  const usage = outcome.usage;
  const repoUrl = `https://github.com/${ctx.repoFullName}`;
  return {
    score: outcome.score,
    label: outcome.label,
    passed: outcome.passed,
    threshold: ctx.settings.threshold,
    previousScore: ctx.previousScore,
    breakdown: outcome.breakdown,
    findings: outcome.findings.map((f) => {
      const commentId = ctx.posted.get(f.index);
      return commentId === undefined
        ? f
        : { ...f, inlineUrl: `${repoUrl}/pull/${ctx.prNumber}#discussion_r${commentId}` };
    }),
    fixed: (ctx.fixed ?? []).map(({ githubCommentId, ...f }) =>
      githubCommentId === null
        ? f
        : { ...f, inlineUrl: `${repoUrl}/pull/${ctx.prNumber}#discussion_r${githubCommentId}` },
    ),
    maxFindings: ctx.settings.maxFindings,
    rejectedCount: outcome.rejected.length,
    categories: ctx.settings.categories,
    reviewedFiles: ctx.files.map((f) => f.path).filter((p) => !skipped.has(p)),
    notReviewed: outcome.skippedFiles,
    changedFiles: ctx.files.length,
    changedLines: ctx.files.reduce((sum, f) => sum + f.additions + f.deletions, 0),
    notes: outcome.notes,
    modelName: outcome.engine === 'fake' ? FAKE_ENGINE_NAME : modelName(outcome.model),
    paidBy: ctx.paidBy ?? null,
    trigger: ctx.trigger,
    durationMs: outcome.durationMs,
    // Same "tokens in" as the dashboard's run details: fresh input plus cache writes and reads.
    tokensIn: usage.inputTokens + usage.cacheWriteTokens + usage.cachedTokens,
    tokensOut: usage.outputTokens,
    costUsd: usage.costUsd,
    headSha: ctx.headSha,
    repoUrl,
    dashboardUrl: ctx.dashboardUrl,
    settingsUrl: ctx.settingsUrl,
  };
}

/** Markdown for the summary comment and the check run of a finished review. */
export function renderResult(input: SummaryInput) {
  return {
    comment: renderSummaryComment(input),
    checkSummary: renderCheckSummary(input),
    partialCoverage: partialCoverage(input),
  };
}

/**
 * Inline comments (spec 7.8, 3.3): blockers and majors only, only on lines of
 * the diff, and never twice for the same file + title + category on this PR
 * (Revo's earlier comments are found on GitHub by their hidden marker, in
 * the App's own comments only: a marker someone else wrote is ignored).
 * `known` are the threads of problems an earlier review found (found again or
 * still open): they keep their thread. Returns the comment id of each
 * confirmed finding shown inline, by index.
 */
export async function postInlineComments(
  octokit: GithubClient,
  ref: RepoRef,
  prNumber: number,
  headSha: string,
  outcome: DoneOutcome,
  files: ChangedFile[],
  app: AppIdentity,
  log: Logger,
  known: ReadonlyMap<number, number> = new Map(),
): Promise<Map<number, number>> {
  const posted = new Map<number, number>(known);
  const candidates = outcome.findings.filter((f) => isInlineSeverity(f.severity) && !known.has(f.index));
  if (candidates.length === 0) return posted;

  const earlier = await listPostedFindingComments(octokit, ref, prNumber, app);
  const patches = new Map(files.map((f) => [f.path, f.patch]));
  const fresh: { index: number; key: string; comment: InlineComment }[] = [];
  for (const f of candidates) {
    const key = findingKey(f);
    const existing = earlier.get(key);
    if (existing !== undefined) {
      posted.set(f.index, existing);
      continue;
    }
    const target = inlineTarget(patches.get(f.file), f.lineStart, f.lineEnd);
    if (target)
      fresh.push({
        index: f.index,
        key,
        comment: { ...target, path: f.file, body: renderInlineComment(f, target) },
      });
  }
  if (fresh.length === 0) return posted;

  try {
    const ids = await createInlineReview(
      octokit,
      ref,
      prNumber,
      headSha,
      fresh.map((c) => c.comment),
    );
    for (const c of fresh) {
      const id = ids.get(c.key);
      if (id !== undefined) posted.set(c.index, id);
    }
  } catch (err) {
    // GitHub refuses the whole review when one line moved (e.g. a push raced the review).
    // The summary comment still lists every finding, so the review itself is not failed.
    if (githubErrorStatus(err) !== 422) throw err;
    log.warn({ pr: prNumber, comments: fresh.length }, 'GitHub refused the inline comments; summary only');
  }
  return posted;
}
