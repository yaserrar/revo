/**
 * Findings across pushes. After a review of a new commit, each problem the
 * previous review left open is either found again (same problem, kept as the
 * same thread), still in the code untouched (carried over: the model may not
 * report it twice, but it is still there and still counts), or gone (fixed).
 * "Still in the code" is decided on the code itself, not by the model: the
 * flagged lines are searched in the file at the new head commit.
 */
import { rangesOverlap, type Category, type Finding, type Severity } from '@revo/shared';
import { createIgnoreMatcher } from './files';
import { compareFindings } from './postprocess';
import { computeScore } from './score';
import { buildSnippet } from './snippet';
import type { ReviewedFinding, ReviewOutcome } from './types';

type DoneOutcome = Extract<ReviewOutcome, { status: 'done' }>;
export type LineRange = { lineStart: number; lineEnd: number };

/** A confirmed problem of the PR's previous review that nobody has fixed or dismissed yet. */
export type PriorFinding = Finding & {
  id: string;
  originalSeverity: Severity | null;
  snippet: string;
  snippetStartLine: number;
  /** Revo's inline comment on GitHub, when it was posted on its line. */
  githubCommentId: number | null;
  /** Head commit of the review that first found it. */
  openSince: string;
  /** A person dismissed it: resolved its thread without a fix, or marked it wrong. */
  dismissed: boolean;
};

/** Where a prior finding's flagged lines are at the new head: a range, or null when they are gone. */
export type LocatedPrior = PriorFinding & { located: LineRange | null };

/** Rejection reason for a problem found again after a person dismissed it. */
export const DISMISSED_REASON = 'Dismissed on an earlier review of this pull request.';

export function carriedReason(sha: string): string {
  return `Found by the review of ${sha.slice(0, 7)}; the flagged lines have not changed since.`;
}

const norm = (line: string) => line.trim();

/** The flagged lines (lineStart..lineEnd) cut from the stored snippet; null when it does not hold them. */
export function flaggedLines(
  f: Pick<PriorFinding, 'snippet' | 'snippetStartLine' | 'lineStart' | 'lineEnd'>,
) {
  if (!f.snippet || f.lineStart < f.snippetStartLine) return null;
  const lines = f.snippet.replace(/\r\n?/g, '\n').split('\n');
  const flagged = lines.slice(f.lineStart - f.snippetStartLine, f.lineEnd - f.snippetStartLine + 1);
  return flagged.length === f.lineEnd - f.lineStart + 1 ? flagged : null;
}

/**
 * Where the finding's flagged lines are in `content` (the file at the new
 * head), compared without surrounding whitespace; the match nearest to the old
 * position wins. Null when the file is gone or the lines no longer appear
 * (the code changed: fixed). When the stored snippet cannot tell (no snippet,
 * or only blank lines), the old range is kept: a problem is never called
 * fixed without evidence.
 */
export function locateFinding(
  f: Pick<PriorFinding, 'snippet' | 'snippetStartLine' | 'lineStart' | 'lineEnd'>,
  content: string | null,
): LineRange | null {
  if (content === null) return null;
  const flagged = flaggedLines(f)?.map(norm);
  if (!flagged || flagged.every((l) => l === '')) return { lineStart: f.lineStart, lineEnd: f.lineEnd };
  const lines = content.replace(/\r\n?/g, '\n').split('\n').map(norm);
  let best: number | null = null;
  for (let i = 0; i + flagged.length <= lines.length; i++) {
    if (!flagged.every((l, k) => lines[i + k] === l)) continue;
    if (best === null || Math.abs(i + 1 - f.lineStart) < Math.abs(best + 1 - f.lineStart)) best = i;
  }
  return best === null ? null : { lineStart: best + 1, lineEnd: best + flagged.length };
}

const identity = (f: Pick<Finding, 'file' | 'category' | 'title'>) =>
  [f.file, f.category, f.title.trim().replace(/\s+/g, ' ').toLowerCase()].join('\n');

/** The same problem: same file, category and title, or same file and category on overlapping lines. */
function isSameProblem(n: ReviewedFinding, p: LocatedPrior): boolean {
  if (identity(n) === identity(p)) return true;
  if (n.file !== p.file || n.category !== p.category) return false;
  const ranges = p.located ? [p.located, p] : [p];
  return ranges.some((r) => rangesOverlap(n.lineStart, n.lineEnd, r.lineStart, r.lineEnd));
}

export type Reconciled = {
  /** The review with carried findings added, found-again dismissed ones rejected, and the score recomputed. */
  outcome: DoneOutcome;
  /** Prior findings whose lines are gone: fixed by the new commits. */
  fixed: LocatedPrior[];
  /** Revo's existing inline comment for findings of the new list, by index (found again or carried). */
  commentIds: Map<number, number>;
};

/**
 * Merges a finished review with the problems the previous review left open
 * (see the file comment), sorted by severity; carried ones are never capped
 * (they are already on GitHub). `contents` holds the files at the new head,
 * for the snippets of carried findings. Problems the repo's settings no longer
 * cover (category turned off, file now ignored) are neither carried nor fixed.
 */
export function reconcileWithPrior(
  outcome: DoneOutcome,
  priors: readonly LocatedPrior[],
  {
    threshold,
    contents,
    categories,
    ignoreGlobs = [],
  }: {
    threshold: number;
    contents: ReadonlyMap<string, string | null>;
    /** The repo's settings now: a problem in a category or file it no longer checks is let go. */
    categories?: readonly Category[];
    ignoreGlobs?: readonly string[];
  },
): Reconciled {
  const isIgnored = createIgnoreMatcher(ignoreGlobs);
  const inScope = (p: LocatedPrior) =>
    p.dismissed || ((!categories || categories.includes(p.category)) && !isIgnored(p.file));
  const unmatched = new Set(priors.filter(inScope));
  const kept: { finding: ReviewedFinding; commentId: number | null }[] = [];
  const dismissedAgain: ReviewedFinding[] = [];

  for (const n of outcome.findings) {
    const prior = [...unmatched].find((p) => isSameProblem(n, p));
    if (!prior) {
      kept.push({ finding: n, commentId: null });
      continue;
    }
    unmatched.delete(prior);
    if (prior.dismissed) dismissedAgain.push({ ...n, reason: DISMISSED_REASON });
    else kept.push({ finding: { ...n, openSince: prior.openSince }, commentId: prior.githubCommentId });
  }

  const fixed: LocatedPrior[] = [];
  for (const p of unmatched) {
    if (p.dismissed) continue;
    if (!p.located) {
      fixed.push(p);
      continue;
    }
    const content = contents.get(p.file);
    const snippet =
      typeof content === 'string'
        ? buildSnippet(
            { path: p.file, status: 'modified', additions: 0, deletions: 0, newContent: content },
            p.located.lineStart,
            p.located.lineEnd,
          )
        : { snippet: p.snippet, snippetStartLine: p.snippetStartLine };
    const { id: _id, githubCommentId, dismissed: _dismissed, located, ...finding } = p;
    kept.push({
      finding: {
        ...finding,
        ...located,
        ...snippet,
        index: 0,
        reason: carriedReason(p.openSince),
      },
      commentId: githubCommentId,
    });
  }

  const ordered = [...kept].sort((a, b) => compareFindings(a.finding, b.finding));
  const findings = ordered.map((k, index) => ({ ...k.finding, index }));
  const commentIds = new Map<number, number>();
  ordered.forEach((k, index) => {
    if (k.commentId !== null) commentIds.set(index, k.commentId);
  });
  const rejected = [...outcome.rejected, ...dismissedAgain]
    .sort(compareFindings)
    .map((f, index) => ({ ...f, index }));
  const score = computeScore(findings, threshold);
  return {
    outcome: {
      ...outcome,
      findings,
      rejected,
      score: score.score,
      label: score.label,
      passed: score.passed,
      counts: score.counts,
      breakdown: score.breakdown,
    },
    fixed,
    commentIds,
  };
}
