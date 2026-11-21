'use client';

import { Chart } from 'iconsax-react';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { InstallCta } from '~/components/dashboard/install-cta';
import { Panel } from '~/components/dashboard/panel';
import { EmptyState } from '~/components/shared/empty-state';
import { ErrorState } from '~/components/shared/error-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import { Skeleton } from '~/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group';
import { usePullRequestFilters } from '~/hooks/prs';
import { useTrends } from '~/hooks/trends';
import { formatInt, formatPercent, formatUsd } from '~/lib/format';
import { cn } from '~/lib/utils';
import { TREND_RANGES } from '~/types/trends';
import { CostChart, FindingsByCategoryChart, PrecisionChart, ScoreByRepoChart } from './trend-charts';
import { TopFiles } from './top-files';

const ALL = 'all';
const RANGE_LABEL = { '7d': '7 days', '30d': '30 days', '90d': '90 days' } as const;

const trendParsers = {
  range: parseAsStringLiteral(TREND_RANGES).withDefault('30d'),
  repo: parseAsString,
};

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 px-5 py-5 sm:px-6">
      <p className="eyebrow truncate">{label}</p>
      <p className="display tabular mt-3 truncate text-[2.6rem] leading-none">{value}</p>
      {note ? <p className="mt-2 truncate font-mono text-[0.6875rem] text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function TrendsView({ installUrl }: { installUrl: string | null }) {
  const [{ range, repo }, setParams] = useQueryStates(trendParsers, { history: 'replace' });
  const filters = usePullRequestFilters();
  const trends = useTrends({ range, repo: repo ?? undefined });
  const data = trends.data;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup
        type="single"
        value={range}
        onValueChange={(v) => v && void setParams({ range: v as (typeof TREND_RANGES)[number] })}
        size="sm"
        aria-label="Period"
        className="gap-0.5 rounded-full border border-border bg-card p-0.5"
      >
        {TREND_RANGES.map((r) => (
          <ToggleGroupItem
            key={r}
            value={r}
            aria-label={RANGE_LABEL[r]}
            className="h-7 rounded-full px-3 font-mono text-xs data-[state=on]:bg-foreground data-[state=on]:text-background aria-pressed:bg-foreground aria-pressed:text-background"
          >
            {r}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Select value={repo ?? ALL} onValueChange={(v) => void setParams({ repo: v === ALL ? null : v })}>
        <SelectTrigger size="sm" className="h-8 min-w-44 rounded-full bg-card" aria-label="Repo">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All repos</SelectItem>
          {(filters.data?.repos ?? []).map((r) => (
            <SelectItem key={r.id} value={r.id}>
              {r.fullName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  if (trends.isPending)
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading trends">
        {toolbar}
        <Skeleton className="h-28 rounded-3xl" />
        <Skeleton className="h-96 rounded-3xl" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80 rounded-3xl" />
          <Skeleton className="h-80 rounded-3xl" />
        </div>
      </div>
    );
  if (trends.isError)
    return (
      <div className="space-y-4">
        {toolbar}
        <ErrorState message={trends.error.message} onRetry={() => void trends.refetch()} />
      </div>
    );
  if (!data) return null;
  // No repo to show yet: the install step, without empty KPIs and a repo picker with nothing in it.
  if (data.repos.length === 0) return <InstallCta installUrl={installUrl} />;

  const t = data.totals;
  const period = RANGE_LABEL[data.range];

  return (
    <div className={cn('space-y-4 transition-opacity', trends.isPlaceholderData && 'opacity-70')}>
      {toolbar}

      <section
        aria-label={`Totals over ${period}`}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border bg-border shadow-card sm:grid-cols-3 lg:grid-cols-6 [&>*]:bg-card"
      >
        <Figure
          label="Avg score"
          value={t.avgScore === null ? '—' : String(Math.round(t.avgScore))}
          note="/ 100"
        />
        <Figure label="Reviews" value={formatInt(t.reviews)} note={`${formatInt(t.prs)} PRs`} />
        <Figure label="Findings" value={formatInt(t.findings)} note="confirmed" />
        <Figure
          label="Precision"
          value={t.precision === null ? '—' : formatPercent(t.precision)}
          note="marked useful"
        />
        <Figure label="Spent" value={formatUsd(t.costUsd)} note={period} />
        <Figure
          label="Per PR"
          value={t.avgCostPerPrUsd === null ? '—' : formatUsd(t.avgCostPerPrUsd)}
          note="average cost"
        />
      </section>

      {t.reviews === 0 ? (
        <EmptyState
          icon={Chart}
          title="Nothing reviewed in this period"
          description="Pick a longer period, another repo, or wait for the next pull request."
        />
      ) : (
        <>
          <Panel eyebrow={`Average score per day · ${period}`} title="Score by repo">
            <ScoreByRepoChart data={data} />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <Panel eyebrow={`Confirmed findings · per ${data.bucket}`} title="What Revo catches">
              <FindingsByCategoryChart data={data} />
            </Panel>
            <Panel eyebrow={`Feedback marked useful · per ${data.bucket}`} title="Precision">
              <PrecisionChart data={data} />
            </Panel>
          </div>

          <Panel
            eyebrow={`Cost per day · ${period}`}
            title={t.avgCostPerPrUsd === null ? 'Cost' : `${formatUsd(t.avgCostPerPrUsd)} per PR`}
          >
            <CostChart data={data} />
          </Panel>
          <Panel eyebrow="Most findings · top 10" title="Hot files">
            {data.topFiles.length > 0 ? (
              <TopFiles files={data.topFiles} />
            ) : (
              <p className="text-sm text-muted-foreground">No confirmed findings in this period.</p>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
