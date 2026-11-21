import 'server-only';
import { decimalToNumber, type PullRequest, type Repo, type Review } from '@revo/db';
import type { PullRequestSummaryDto, Severity, SeverityCounts } from '@revo/shared';

export type PullRequestRow = PullRequest & {
  repo: Pick<Repo, 'id' | 'fullName'>;
  /** Newest first; only the first is used. */
  reviews: (Review & { findings: { severity: Severity }[] })[];
};

export function severityCounts(findings: readonly { severity: Severity }[]): SeverityCounts {
  const counts: SeverityCounts = { blocker: 0, major: 0, minor: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/** `reviews[0]` must be the latest review with its confirmed findings. */
export function presentPullRequestSummary(p: PullRequestRow): PullRequestSummaryDto {
  const latest = p.reviews[0] ?? null;
  return {
    id: p.id,
    repo: { id: p.repo.id, fullName: p.repo.fullName },
    number: p.number,
    title: p.title,
    author: p.author,
    authorAvatarUrl: p.authorAvatarUrl,
    state: p.state,
    draft: p.draft,
    url: p.url,
    baseRef: p.baseRef,
    headRef: p.headRef,
    latestReview: latest
      ? {
          id: latest.id,
          status: latest.status,
          score: latest.score,
          label: latest.label,
          passed: latest.passed,
          headSha: latest.headSha,
          createdAt: latest.createdAt.toISOString(),
          costUsd: decimalToNumber(latest.costUsd),
          skipReason: latest.skipReason,
        }
      : null,
    severityCounts:
      latest?.status === 'done' ? severityCounts(latest.findings) : { blocker: 0, major: 0, minor: 0 },
    lastReviewedAt: (latest?.createdAt ?? p.lastReviewedAt)?.toISOString() ?? null,
    openedAt: p.openedAt.toISOString(),
  };
}
