'use client';

import { parseAsString, useQueryState } from 'nuqs';
import { BudgetBanner } from '~/components/dashboard/budget-banner';
import { Panel } from '~/components/dashboard/panel';
import { ErrorState } from '~/components/shared/error-state';
import { Skeleton } from '~/components/ui/skeleton';
import { usePullRequest } from '~/hooks/prs';
import { useReview } from '~/hooks/reviews';
import { ApiError } from '~/services/api/client';
import { FindingCard } from './finding-card';
import { PrHeader } from './pr-header';
import { RejectedFindings } from './rejected-findings';
import { ReviewHistory } from './review-history';
import { ReviewState } from './review-state';
import { RunDetails } from './run-details';
import { ScoreBreakdown } from './score-breakdown';

export function PrDetailView({ id, login }: { id: string; login: string }) {
  const pr = usePullRequest(id);
  const [reviewParam, setReviewParam] = useQueryState(
    'review',
    parseAsString.withOptions({ history: 'replace' }),
  );
  const reviews = pr.data?.reviews ?? [];
  const selected = reviews.find((r) => r.id === reviewParam) ?? reviews[0] ?? null;
  const detail = useReview(selected?.status === 'done' ? selected.id : null);

  if (pr.isPending) return <DetailSkeleton />;
  if (pr.isError) {
    const missing = pr.error instanceof ApiError && pr.error.status === 404;
    return (
      <ErrorState
        title={missing ? 'Pull request not found' : 'This did not load'}
        message={missing ? 'It does not exist, or it is in a repo you cannot access.' : pr.error.message}
        onRetry={missing ? undefined : () => void pr.refetch()}
      />
    );
  }

  const data = pr.data;
  const review = selected;
  const d = detail.data?.review.id === review?.id ? detail.data : undefined;

  return (
    <>
      <PrHeader pr={data} review={review} previousScore={d?.previousScore ?? null} />
      {data.budget.reached ? <BudgetBanner budgets={[data.budget]} className="mb-8" /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-8">
        <div className="min-w-0 space-y-6">
          {!review ? (
            <ReviewStateEmpty />
          ) : review.status !== 'done' ? (
            <ReviewState review={review} />
          ) : detail.isError ? (
            <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />
          ) : !d ? (
            <FindingsSkeleton />
          ) : (
            <>
              <Panel eyebrow="Score breakdown" title="Every point lost has a reason">
                <ScoreBreakdown rows={d.breakdown} score={review.score ?? 0} />
              </Panel>
              {d.findings.length === 0 ? (
                <ReviewState review={review} />
              ) : (
                <section aria-labelledby="findings-heading" className="space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 pt-4">
                    <h2 id="findings-heading" className="display text-4xl">
                      {d.findings.length} {d.findings.length === 1 ? 'finding' : 'findings'}
                    </h2>
                    <p className="eyebrow">Confirmed by a second pass · sorted by severity</p>
                  </div>
                  {d.findings.map((f, i) => (
                    <FindingCard key={f.id} finding={f} position={i} reviewId={review.id} login={login} />
                  ))}
                </section>
              )}
              <RejectedFindings items={d.rejected} />
            </>
          )}
        </div>

        <aside
          className="space-y-6 lg:sticky lg:top-28 lg:self-start"
          aria-label="Review history and run details"
        >
          <Panel eyebrow={`Review history · ${reviews.length}`} bodyClassName="p-2 sm:p-2 pt-2 sm:pt-2">
            {reviews.length > 0 ? (
              <ReviewHistory
                reviews={reviews}
                selectedId={review?.id ?? null}
                onSelect={(rid) => void setReviewParam(rid === reviews[0]?.id ? null : rid)}
              />
            ) : (
              <p className="px-3 py-2 text-sm text-muted-foreground">No review yet.</p>
            )}
          </Panel>
          {review ? (
            <Panel eyebrow="Run details">
              <RunDetails review={review} />
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}

function ReviewStateEmpty() {
  return (
    <section className="rounded-3xl border border-dashed border-border p-8">
      <h2 className="display text-3xl">Not reviewed yet</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Revo reviews this pull request after the next push, or when you ask it to review again.
      </p>
    </section>
  );
}

function FindingsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading findings">
      <Skeleton className="h-64 rounded-3xl" />
      <Skeleton className="h-96 rounded-3xl" />
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading pull request" className="space-y-10">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-14 w-4/5" />
          <Skeleton className="h-6 w-60" />
          <Skeleton className="h-9 w-72" />
        </div>
        <Skeleton className="mx-auto size-[280px] rounded-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <FindingsSkeleton />
        <Skeleton className="h-96 rounded-3xl" />
      </div>
    </div>
  );
}
