'use client';

import { useId } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  CHART_COLORS,
  thresholdLine,
  chartAxis,
  chartCursor,
  chartGrid,
  chartLine,
  ChartTooltip,
  chartYAxis,
} from '~/components/revo/chart-theme';
import { scoreAxisFloor } from '~/lib/metrics';
import { formatBucket } from '~/lib/time-buckets';
import type { ScoreDayDto } from '~/types/overview';

/**
 * Average score per day with the red threshold (when the repos share one);
 * gaps (days without reviews) are bridged.
 */
export function ScoreChart({ data, threshold }: { data: ScoreDayDto[]; threshold: number | null }) {
  const id = useId().replace(/:/g, '');
  const floor = scoreAxisFloor(
    data.map((d) => d.avgScore),
    threshold,
  );
  const ticks = Array.from({ length: (100 - floor) / 10 + 1 }, (_, i) => floor + i * 10).filter(
    (t, i, all) => all.length <= 6 || i % 2 === 0 || t === 100,
  );
  return (
    <div className="h-60 w-full sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 16, right: 24, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`score-fill-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.accent} stopOpacity={0.2} />
              <stop offset="100%" stopColor={CHART_COLORS.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="date" {...chartAxis} tickFormatter={formatBucket} interval="preserveStartEnd" />
          <YAxis {...chartYAxis} domain={[floor, 100]} ticks={ticks} />
          {threshold !== null ? <ReferenceLine {...thresholdLine(threshold)} /> : null}
          <Tooltip
            cursor={chartCursor}
            content={
              <ChartTooltip formatLabel={(l) => formatBucket(String(l))} formatValue={(v) => `${v} / 100`} />
            }
          />
          <Area
            {...chartLine}
            dataKey="avgScore"
            name="Average score"
            connectNulls
            stroke={CHART_COLORS.accent}
            fill={`url(#score-fill-${id})`}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
