'use client';

import { ArrowRight, Chart, Coin1, Like1, TaskSquare } from 'iconsax-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SCORE_LABEL_TEXT, scoreLabel } from '@revo/shared';
import { BudgetBanner } from '~/components/dashboard/budget-banner';
import { InstallCta } from '~/components/dashboard/install-cta';
import { Panel } from '~/components/dashboard/panel';
import { Sparkline } from '~/components/revo/sparkline';
import { Delta, Meter, StatCard } from '~/components/revo/stat-card';
import { EmptyState } from '~/components/shared/empty-state';
import { ErrorState } from '~/components/shared/error-state';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { useOverview } from '~/hooks/overview';
import { formatInt, formatUsd } from '~/lib/format';
import { formatBucket } from '~/lib/time-buckets';
import type { ScoreDayDto } from '~/types/overview';
import { delta, scoreAxisFloor, trendDirection } from '~/lib/metrics';
import { LatestReviews } from './latest-reviews';
import { ScoreChart } from './score-chart';

const TREND_TITLE = { up: 'Trending up', down: 'Slipping', flat: 'Holding steady' } as const;

const monthName = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(iso));

export function OverviewView({ installUrl }: { installUrl: string | null }) {
  const { data, isPending, isError, error, refetch } = useOverview();

  if (isPending) return <OverviewSkeleton />;
  if (isError) return <ErrorState message={error.message} onRetry={() => void refetch()} className="mt-2" />;
  if (data.repoCount === 0) return <InstallCta installUrl={installUrl} />;

  const now = new Date();
  const avg = data.avgScore.thisWeek;
  const scoreDelta = delta(avg, data.avgScore.lastWeek);
  const prDelta = data.prsReviewed.thisWeek - data.prsReviewed.lastWeek;
  const trend = trendDirection(data.scoreByDay.map((d) => d.avgScore));
  const scoreSeries = data.scoreByDay.flatMap((d) => (d.avgScore === null ? [] : [d.avgScore]));
  const lastWeek = data.scoreByDay.slice(-7);
  const { useful, wrong, rate } = data.precision;

  return (
    <div className="space-y-4">
      <BudgetBanner budgets={data.budgetReached} className="mb-6" />

      <h2 className="sr-only">At a glance</h2>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          emphasis
          label="Average score · 7 days"
          value={avg ?? '—'}
          unit={avg === null ? undefined : '/ 100'}
          delta={
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {avg !== null ? (
                <span className="eyebrow text-background/80">{SCORE_LABEL_TEXT[scoreLabel(avg)]}</span>
              ) : (
                <span className="eyebrow text-background/80">No review this week</span>
              )}
              {scoreDelta !== null ? (
                <Delta value={scoreDelta} caption="vs last week" className="[&_span]:text-background/80" />
              ) : null}
            </div>
          }
          className="col-span-2 lg:row-span-2"
          footnote="Computed from confirmed findings only · bars: daily average"
        >
          <WeekBars days={lastWeek} threshold={data.threshold} />
        </StatCard>
        <StatCard
          label="Reviewed · 7d"
          value={<Small>{formatInt(data.prsReviewed.thisWeek)}</Small>}
          icon={<TaskSquare className="size-[18px]" />}
          delta={<Delta value={prDelta} caption="vs last week" />}
        >
          <Sparkline data={data.prsReviewed.perDay} domain={[0, Math.max(1, ...data.prsReviewed.perDay)]} />
        </StatCard>
        <StatCard
          label={`Precision · ${data.precision.windowDays}d`}
          value={<Small>{rate === null ? '—' : Math.round(rate * 100)}</Small>}
          unit={rate === null ? undefined : '%'}
          icon={<Like1 className="size-[18px]" />}
          footnote={
            useful + wrong === 0
              ? 'No feedback yet: 👍/👎 on GitHub, or Useful/Wrong here'
              : `${formatInt(useful)} useful · ${formatInt(wrong)} wrong`
          }
        >
          <Meter value={rate === null ? 0 : rate * 100} max={100} label="Findings marked useful" />
        </StatCard>
        <StatCard
          label={`Spent · ${monthName(data.cost.monthStart)}`}
          value={<Small>{formatUsd(data.cost.spentUsd)}</Small>}
          icon={<Coin1 className="size-[18px]" />}
          footnote={`of ${formatUsd(data.cost.budgetUsd)} budget`}
        >
          <Meter
            value={data.cost.spentUsd}
            max={data.cost.budgetUsd}
            kind="budget"
            label="Spent against budget"
          />
        </StatCard>
        <StatCard
          label={`Per PR · ${monthName(data.cost.monthStart)}`}
          value={<Small>{data.cost.avgPerPrUsd === null ? '—' : formatUsd(data.cost.avgPerPrUsd)}</Small>}
          icon={<Chart className="size-[18px]" />}
          footnote="Line: daily spend"
        >
          <Sparkline
            data={data.cost.perDay}
            color="var(--chart-neutral)"
            domain={[0, Math.max(0.01, ...data.cost.perDay)]}
          />
        </StatCard>
      </div>

      <Panel
        eyebrow="Average score · 30 days"
        title={scoreSeries.length > 0 ? TREND_TITLE[trend] : 'No scores yet'}
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/trends">
              Trends
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
      >
        <ScoreChart data={data.scoreByDay} threshold={data.threshold} />
      </Panel>

      <Panel
        eyebrow="Latest reviews"
        title="Fresh off the queue"
        labelledBy="latest-reviews-title"
        divided
        bodyClassName="p-0 sm:p-0 pt-0 sm:pt-0"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/prs">
              All pull requests
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
      >
        {data.latestReviews.length === 0 ? (
          <EmptyState
            icon={TaskSquare}
            title="Waiting for the first PR"
            description="Open a pull request on a repo where Revo is installed. Its score appears here within two minutes."
            className="m-5 sm:m-6"
          />
        ) : (
          <LatestReviews items={data.latestReviews} now={now} />
        )}
      </Panel>
    </div>
  );
}

const weekday = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'narrow', timeZone: 'UTC' }).format(new Date(iso));

/**
 * The last 7 days of the hero tile: one bar per day at its average score
 * (a dashed stub on days without a review), so the tile shows the week its
 * number summarises, not the 30-day line drawn below it.
 */
function WeekBars({ days, threshold }: { days: ScoreDayDto[]; threshold: number | null }) {
  const floor = scoreAxisFloor(
    days.map((d) => d.avgScore),
    threshold,
  );
  return (
    <ol
      className="grid h-32 grid-cols-7 items-end gap-2 sm:h-40 sm:gap-3"
      aria-label="Average score per day, last 7 days"
    >
      {days.map((d) => {
        const height = d.avgScore === null ? 0 : Math.max(6, ((d.avgScore - floor) / (100 - floor)) * 100);
        return (
          <li key={d.date} className="flex h-full min-w-0 flex-col items-center justify-end gap-2">
            <span className="sr-only">
              {formatBucket(d.date)}: {d.avgScore === null ? 'no review' : `${Math.round(d.avgScore)} / 100`}
            </span>
            {d.avgScore === null ? (
              <span aria-hidden="true" className="w-full border-t border-dashed border-background/30" />
            ) : (
              <span
                aria-hidden="true"
                className="w-full rounded-t-md bg-background/85"
                style={{ height: `${height}%` }}
              />
            )}
            <span aria-hidden="true" className="font-mono text-[0.625rem] text-background/60 uppercase">
              {weekday(d.date)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Small tiles sit two per row on phones: a size down for their numerals. */
function Small({ children }: { children: ReactNode }) {
  return <span className="max-sm:text-[2.75rem]">{children}</span>;
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading overview">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Skeleton className="col-span-2 h-64 rounded-3xl lg:row-span-2 lg:h-auto" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-52 rounded-3xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-3xl" />
      <Skeleton className="h-96 rounded-3xl" />
    </div>
  );
}
