'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { CATEGORIES, CATEGORY_LABELS } from '@revo/shared';
import {
  CATEGORY_COLORS,
  CHART_COLORS,
  chartAxis,
  chartCursor,
  chartGrid,
  chartLine,
  ChartTooltip,
  chartYAxis,
} from '~/components/revo/chart-theme';
import { FINDINGS_BY_WEEK, SCORE_30_DAYS } from './kit-data';

/** Average score per day over 30 days, with the default red threshold. */
export function ScoreTrendChart() {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={SCORE_30_DAYS} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="kit-score-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS.accent} stopOpacity={0.18} />
              <stop offset="100%" stopColor={CHART_COLORS.accent} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...chartGrid} />
          <XAxis dataKey="day" {...chartAxis} interval="preserveStartEnd" />
          <YAxis {...chartYAxis} domain={[60, 100]} ticks={[60, 70, 80, 90, 100]} />
          <ReferenceLine
            y={70}
            stroke="var(--bad)"
            strokeDasharray="4 4"
            strokeOpacity={0.6}
            label={{
              value: 'THRESHOLD 70',
              position: 'insideBottomRight',
              fill: 'var(--muted-foreground)',
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
            }}
          />
          <Tooltip cursor={chartCursor} content={<ChartTooltip formatValue={(v) => `${v} / 100`} />} />
          <Area
            {...chartLine}
            dataKey="score"
            name="Average score"
            stroke={CHART_COLORS.accent}
            fill="url(#kit-score-fill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Findings by category per week: stacked, fixed category colours, 2px surface gaps. */
export function FindingsByCategoryChart() {
  return (
    <div className="space-y-4">
      <div className="h-52 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={FINDINGS_BY_WEEK}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barCategoryGap="28%"
          >
            <CartesianGrid {...chartGrid} />
            <XAxis dataKey="week" {...chartAxis} />
            <YAxis {...chartYAxis} allowDecimals={false} />
            <Tooltip cursor={{ fill: 'var(--muted)', opacity: 0.6 }} content={<ChartTooltip />} />
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
      <ul className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Legend">
        {CATEGORIES.map((c) => (
          <li key={c} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              className="size-2.5 rounded-[3px]"
              style={{ background: CATEGORY_COLORS[c] }}
              aria-hidden="true"
            />
            {CATEGORY_LABELS[c]}
          </li>
        ))}
      </ul>
    </div>
  );
}
