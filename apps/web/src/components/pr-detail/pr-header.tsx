'use client';

import { ArrowLeft, ExportSquare, Hierarchy3, Refresh2 } from 'iconsax-react';
import Link from 'next/link';
import { toast } from 'sonner';
import type { ReviewDto } from '@revo/shared';
import { CheckChip, PrStateChip, ReviewStatusChip } from '~/components/revo/chips';
import { ScoreDelta } from '~/components/revo/score-badge';
import { ScoreDial } from '~/components/revo/score-dial';
import { UserAvatar } from '~/components/shared/user-avatar';
import { Button } from '~/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { useReviewAgain } from '~/hooks/prs';
import { formatDate, shortSha } from '~/lib/format';
import type { PullRequestDetailDto } from '~/types/pull-request';

const DIAL_LABEL: Partial<Record<ReviewDto['status'], string>> = {
  queued: 'Queued',
  running: 'Reviewing',
  skipped: 'Skipped',
  failed: 'Failed',
};

/** Title, repo, author, branches, GitHub link, the big score and its status (spec 11.4). */
export function PrHeader({
  pr,
  review,
  previousScore,
}: {
  pr: PullRequestDetailDto;
  review: ReviewDto | null;
  previousScore: number | null;
}) {
  const again = useReviewAgain(pr.id);
  const score = review?.status === 'done' ? review.score : null;
  const dialLabel =
    review && review.status !== 'done' ? DIAL_LABEL[review.status] : review ? undefined : 'Not reviewed';
  const reviewAgain = () =>
    again.mutate(undefined, {
      onSuccess: () =>
        toast.success('Review queued', {
          description: `Revo will review ${shortSha(pr.headSha)} again. This page updates when it finishes.`,
        }),
    });

  const againButton = (
    <Button variant="accent" onClick={reviewAgain} disabled={!pr.reviewAgain.allowed || again.isPending}>
      <Refresh2 className={again.isPending ? 'size-4 animate-spin' : 'size-4'} />
      {again.isPending ? 'Queuing…' : 'Review again'}
    </Button>
  );

  return (
    <header className="mb-10 sm:mb-12">
      <Link
        href="/prs"
        className="eyebrow mb-8 inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ArrowLeft className="size-3.5" />
        Pull requests
      </Link>
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-14">
        <div className="min-w-0 space-y-5">
          <p className="eyebrow">
            <a href={pr.repo.url} className="hover:text-foreground hover:underline">
              {pr.repo.fullName}
            </a>{' '}
            · #{pr.number}
          </p>
          <h1 className="display text-[2.4rem] leading-[1.02] text-balance break-words sm:text-6xl">
            {pr.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <PrStateChip state={pr.state} draft={pr.draft} />
            {review?.status === 'done' ? (
              <CheckChip passed={review.passed} />
            ) : review ? (
              <ReviewStatusChip status={review.status} skipReason={review.skipReason} />
            ) : null}
            {review?.status === 'done' && previousScore !== null && review.score !== null ? (
              <span className="ml-1 inline-flex items-center gap-2">
                <span className="eyebrow">Previous</span>
                <ScoreDelta from={previousScore} to={review.score} />
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-4 font-mono text-xs">
            <span className="flex items-center gap-2">
              <UserAvatar login={pr.author} src={pr.authorAvatarUrl} size="sm" className="size-5" />
              {pr.author}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
              <Hierarchy3 className="size-3.5 shrink-0" />
              <span className="truncate text-foreground">{pr.headRef}</span>
              <span aria-label="into">→</span>
              <span className="text-foreground">{pr.baseRef}</span>
            </span>
            <span className="text-muted-foreground">opened {formatDate(pr.openedAt)}</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {pr.reviewAgain.allowed ? (
              againButton
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {againButton}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{pr.reviewAgain.reason}</TooltipContent>
              </Tooltip>
            )}
            <Button asChild variant="outline">
              <a href={pr.url} target="_blank" rel="noreferrer">
                Open on GitHub
                <ExportSquare className="size-4" />
              </a>
            </Button>
          </div>
          {!pr.reviewAgain.allowed && pr.reviewAgain.reason ? (
            <p className="font-mono text-[0.6875rem] text-muted-foreground">{pr.reviewAgain.reason}</p>
          ) : null}
        </div>
        <div className="order-first flex justify-center lg:order-none lg:justify-end">
          {(['lg', 'xl'] as const).map((size) => (
            <ScoreDial
              key={`${review?.id ?? 'none'}-${size}`}
              score={score}
              size={size}
              label={dialLabel}
              className={size === 'lg' ? 'sm:hidden' : 'hidden sm:inline-grid'}
            />
          ))}
        </div>
      </div>
    </header>
  );
}
