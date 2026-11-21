import Link from 'next/link';
import { ReviewStatusChip } from '~/components/revo/chips';
import { ScoreBadge, ScoreDelta } from '~/components/revo/score-badge';
import { UserAvatar } from '~/components/shared/user-avatar';
import { formatRelative, formatUsd } from '~/lib/format';
import { cn } from '~/lib/utils';
import type { ReviewFeedItemDto } from '~/types/overview';

/**
 * The most recently reviewed PRs as an editorial list, one row per PR: its
 * latest score (with the change since its previous review), the commit,
 * status, cost and time.
 */
export function LatestReviews({ items, now }: { items: ReviewFeedItemDto[]; now: Date }) {
  return (
    <ol className="divide-y divide-border">
      {items.map((r) => (
        <li key={r.id}>
          <Link
            href={`/prs/${r.pullRequestId}?review=${r.id}`}
            className="group grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-5 py-3.5 transition-colors outline-none hover:bg-paper-sunken focus-visible:bg-paper-sunken focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:grid-cols-[4.25rem_minmax(0,1fr)_auto_auto] sm:gap-x-5 sm:px-6"
          >
            <ScoreBadge score={r.status === 'done' ? r.score : null} />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-medium group-hover:underline group-hover:decoration-border group-hover:underline-offset-4">
                {r.prTitle}
              </span>
              <span className="mt-1 flex min-w-0 items-center gap-2 font-mono text-xs text-muted-foreground">
                <UserAvatar login={r.author} src={r.authorAvatarUrl} size="sm" className="size-4" />
                <span className="truncate">
                  {r.repoFullName.split('/')[1]} · #{r.prNumber} · {r.author} ·{' '}
                  <span title={`Commit ${r.headSha}`}>{r.headSha.slice(0, 7)}</span>
                </span>
              </span>
            </span>
            <span
              className={cn(
                'col-start-2 flex items-center gap-2 sm:col-start-auto sm:justify-end',
                r.status === 'done' && 'max-sm:hidden',
              )}
            >
              {r.status !== 'done' ? <ReviewStatusChip status={r.status} skipReason={r.skipReason} /> : null}
              {r.status === 'done' && r.score !== null && r.previousScore !== null ? (
                <ScoreDelta from={r.previousScore} to={r.score} className="sm:w-24 sm:justify-end" />
              ) : null}
              {r.status === 'done' ? (
                <span className="tabular w-14 text-right font-mono text-xs text-muted-foreground">
                  {formatUsd(r.costUsd)}
                </span>
              ) : null}
            </span>
            <time
              dateTime={r.createdAt}
              className="hidden text-right font-mono text-xs whitespace-nowrap text-muted-foreground sm:block sm:w-28"
            >
              {formatRelative(r.createdAt, now)}
            </time>
          </Link>
        </li>
      ))}
    </ol>
  );
}
