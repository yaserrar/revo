'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CATEGORIES, CATEGORY_LABELS } from '@revo/shared';
import { ChartLegend } from '~/components/dashboard/chart-legend';
import {
  CATEGORY_COLORS,
  CHART_COLORS,
  chartAxis,
  chartCursor,
  chartGrid,
  chartLine,
  ChartTooltip,
  chartYAxis,
  SERIES_COLORS,
  thresholdLine,
} from '~/components/revo/chart-theme';
import { formatUsd } from '~/lib/format';
import { scoreAxisFloor } from '~/lib/metrics';
import { formatBucket } from '~/lib/time-buckets';
import type { TrendsDto } from '~/types/trends';

const bucketLabel = (bucket: TrendsDto['bucket']) => (l: unknown) =>
  bucket === 'week' ? `Week of ${formatBucket(String(l))}` : formatBucket(String(l));

/**
 * Average score per day, one line per repo (fixed colour slots in repo order),
 * with the red threshold when the repos in scope share one.
 */
export function ScoreByRepoChart({ data }: { data: TrendsDto }) {
  const values = data.scoreByRepo.flatMap((p) => data.repos.map((r) => p[r.id] as number | null));
  const floor = scoreAxisFloor(values, data.threshold);
  return (
    <div className="space-y-4">
      <div className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.scoreByRepo} margin={{ top: 16, right: 24, bottom: 0, left: 0 }}>
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="date" {...chartAxis} tickFormatter={formatBucket} interval="preserveStartEnd" />
            <YAxis {...chartYAxis} domain={[floor, 100]} />
            {data.threshold !== null ? <ReferenceLine {...thresholdLine(data.threshold)} /> : null}
            <Tooltip
              cursor={chartCursor}
              content={
                <ChartTooltip formatLabel={(l) => formatBucket(String(l))} formatValue={(v) => `${v}`} />
              }
            />
            {data.repos.map((r, i) => (
              <Line
                key={r.id}
                {...chartLine}
                dataKey={r.id}
                name={r.name}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {data.repos.length > 1 ? (
        <ChartLegend
          items={data.repos.map((r, i) => ({
            key: r.id,
            label: r.name,
            color: SERIES_COLORS[i % SERIES_COLORS.length]!,
          }))}
        />
      ) : null}
    </div>
  );
}

/** Confirmed findings per category per bucket, stacked, categories keep their colour. */
export function FindingsByCategoryChart({ data }: { data: TrendsDto }) {
  return (
    <div className="space-y-4">
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data.findingsByCategory}
            margin={{ top: 8, right: 24, bottom: 0, left: 0 }}
            barCategoryGap="28%"
          >
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="date" {...chartAxis} tickFormatter={formatBucket} />
            <YAxis {...chartYAxis} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
              content={<ChartTooltip formatLabel={bucketLabel(data.bucket)} />}
            />
            {CATEGORIES.map((c, i) => (
              <Bar
                key={c}
                dataKey={c}
                name={CATEGORY_LABELS[c]}
                stackId="findings"
                fill={CATEGORY_COLORS[c]}
                stroke="var(--card)"
                strokeWidth={2}
                radius={i === CATEGORIES.length - 1 ? [4, 4, 0, 0] : 0}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend
        items={CATEGORIES.map((c) => ({ key: c, label: CATEGORY_LABELS[c], color: CATEGORY_COLORS[c] }))}
      />
    </div>
  );
}

/** Share of feedback marked useful, per bucket. */
export function PrecisionChart({ data }: { data: TrendsDto }) {
  const points = data.precision.map((p) => ({
    date: p.date,
    rate: p.rate === null ? null : Math.round(p.rate * 100),
  }));
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 24, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="precision-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.good} stopOpacity={0.2} />
              <stop offset="100%" stopColor={CHART_COLORS.good} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="date" {...chartAxis} tickFormatter={formatBucket} />
          <YAxis
            {...chartYAxis}
            width={40}
            domain={[0, 100]}
            ticks={[0, 50, 100]}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            cursor={chartCursor}
            content={<ChartTooltip formatLabel={bucketLabel(data.bucket)} formatValue={(v) => `${v}%`} />}
          />
          <Area
            {...chartLine}
            dataKey="rate"
            name="Marked useful"
            connectNulls
            stroke={CHART_COLORS.good}
            fill="url(#precision-fill)"
            dot={{ r: 2.5, strokeWidth: 0, fill: CHART_COLORS.good }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Spend per day. */
export function CostChart({ data }: { data: TrendsDto }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data.costByDay}
          margin={{ top: 8, right: 24, bottom: 0, left: 0 }}
          barCategoryGap="22%"
        >
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="date" {...chartAxis} tickFormatter={formatBucket} interval="preserveStartEnd" />
          <YAxis {...chartYAxis} width={44} tickFormatter={(v: number) => `$${v.toFixed(v < 1 ? 2 : 0)}`} />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
            content={
              <ChartTooltip formatLabel={(l) => formatBucket(String(l))} formatValue={(v) => formatUsd(v)} />
            }
          />
          <Bar dataKey="costUsd" name="Spent" fill={CHART_COLORS.accent} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
