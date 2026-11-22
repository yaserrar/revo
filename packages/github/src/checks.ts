import {
  CHECK_RUN_NAME,
  FREE_PAUSED_TEXT,
  freeLimitText,
  SCORE_LABEL_TEXT,
  SKIP_REASON_LABELS,
  startOfNextUtcMonth,
  type ScoreLabel,
  type SkipReason,
} from '@revo/shared';
import type { GithubClient, RepoRef } from './client';

/** What a check run shows. `conclusion` is set only when the check is completed. */
export type CheckPresentation =
  | { status: 'in_progress'; title: string; summary: string }
  | { status: 'completed'; conclusion: 'success' | 'failure' | 'neutral'; title: string; summary: string };

export const REVIEWING_TITLE = `${CHECK_RUN_NAME}: reviewing…`;
export const FAILED_TITLE = `${CHECK_RUN_NAME} couldn't review this PR`;
export const SUPERSEDED_TITLE = 'Superseded by a newer commit';

export function reviewingCheck(): CheckPresentation {
  return {
    status: 'in_progress',
    title: REVIEWING_TITLE,
    summary: 'Revo is reading the changes. The result appears here and in a comment on the PR.',
  };
}

/** Spec 7.8: green when passed, red otherwise; title "Score 72/100, needs a look". */
export function resultCheck(input: {
  score: number;
  label: ScoreLabel;
  passed: boolean;
  summary: string;
  /** "10 of 69 files reviewed" when only part of a large PR was read. */
  partialCoverage?: string | null;
}): CheckPresentation {
  const partial = input.partialCoverage ? ` (${input.partialCoverage})` : '';
  return {
    status: 'completed',
    conclusion: input.passed ? 'success' : 'failure',
    title: `Score ${input.score}/100, ${SCORE_LABEL_TEXT[input.label].toLowerCase()}${partial}`,
    summary: input.summary,
  };
}

const SKIP_SUMMARIES: Record<SkipReason, string> = {
  draft: 'Draft pull requests are not reviewed. Revo reviews it when it is marked ready for review.',
  bot: 'Pull requests opened by bots are not reviewed for this repo. Change it in the repo settings.',
  budget:
    'This repo reached its monthly AI budget, so reviews are paused until next month. Raise the budget in the repo settings to resume.',
  too_large: 'This pull request is too large to review. Split it into smaller pull requests.',
  no_reviewable_files:
    'Every changed file is ignored (lockfiles, generated code, binaries or the ignore patterns in the repo settings).',
  disabled: 'Reviews are turned off for this repo in the Revo dashboard.',
  free_limit:
    'Free reviews for this account are used up until next month. Add your own Anthropic API key in Revo for unlimited reviews.',
  free_paused: FREE_PAUSED_TEXT,
};

/** What a skip summary can name: the account (free reviews used up) and when the free tier resets. */
export type SkipDetail = { accountLogin?: string; resetsAt?: Date };

/** Neutral check for a skipped review ("Monthly budget reached", …). */
export function skippedCheck(reason: SkipReason, detail: SkipDetail = {}): CheckPresentation {
  return {
    status: 'completed',
    conclusion: 'neutral',
    title: SKIP_REASON_LABELS[reason],
    summary:
      reason === 'free_limit' && detail.accountLogin
        ? freeLimitText(detail.accountLogin, detail.resetsAt ?? startOfNextUtcMonth())
        : SKIP_SUMMARIES[reason],
  };
}

/** Neutral check after the last retry failed (spec 7.9). */
export function failedCheck(): CheckPresentation {
  return {
    status: 'completed',
    conclusion: 'neutral',
    title: FAILED_TITLE,
    summary:
      'Something went wrong while reviewing this commit, and the retries failed too. Push a new commit or use "Review again" in the dashboard.',
  };
}

/** Neutral check when the PR was closed before its review ran. */
export function closedCheck(): CheckPresentation {
  return {
    status: 'completed',
    conclusion: 'neutral',
    title: 'Pull request closed before the review',
    summary: 'The pull request was closed or merged before Revo reviewed it, so no review ran.',
  };
}

/** Neutral check on a commit whose review was replaced by a newer push. */
export function supersededCheck(): CheckPresentation {
  return {
    status: 'completed',
    conclusion: 'neutral',
    title: SUPERSEDED_TITLE,
    summary: 'A newer commit was pushed before this one was reviewed. Revo reviews the latest commit.',
  };
}

function checkBody(p: CheckPresentation, detailsUrl?: string) {
  return {
    status: p.status,
    ...(p.status === 'completed' ? { conclusion: p.conclusion, completed_at: new Date().toISOString() } : {}),
    ...(p.status === 'in_progress' ? { started_at: new Date().toISOString() } : {}),
    ...(detailsUrl ? { details_url: detailsUrl } : {}),
    output: { title: p.title, summary: p.summary },
  };
}

/** Creates the "Revo" check run on a commit. Returns its id. */
export async function createCheckRun(
  octokit: GithubClient,
  ref: RepoRef,
  headSha: string,
  presentation: CheckPresentation,
  detailsUrl?: string,
): Promise<number> {
  const { data } = await octokit.request('POST /repos/{owner}/{repo}/check-runs', {
    ...ref,
    name: CHECK_RUN_NAME,
    head_sha: headSha,
    ...checkBody(presentation, detailsUrl),
  });
  return Number(data.id);
}

export async function updateCheckRun(
  octokit: GithubClient,
  ref: RepoRef,
  checkRunId: number,
  presentation: CheckPresentation,
  detailsUrl?: string,
): Promise<void> {
  await octokit.request('PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}', {
    ...ref,
    check_run_id: checkRunId,
    ...checkBody(presentation, detailsUrl),
  });
}
