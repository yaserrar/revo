'use client';

import type { ReactNode } from 'react';
import type { TooltipContentProps } from 'recharts';
import type { Category } from '@revo/shared';
import { CATEGORIES } from '@revo/shared';

/**
 * Recharts styling that matches the paper-and-ink system: thin lines,
 * recessive dashed horizontal grid, mono tick labels, colours from tokens.
 * Spread the props: <XAxis {...chartAxis} />, <CartesianGrid {...chartGrid} />.
 */
export const CHART_COLORS = {
  accent: 'var(--chart-1)',
  neutral: 'var(--chart-neutral)',
  grid: 'var(--chart-grid)',
  good: 'var(--good)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
} as const;

/**
 * Categorical slots in fixed order: never cycle, never reorder by rank. They
 * avoid the accent and the good/warn/bad hues (those only carry meaning).
 */
export const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
] as const;

/** Each finding category keeps the same colour on every chart. */
export const CATEGORY_COLORS = Object.fromEntries(CATEGORIES.map((c, i) => [c, SERIES_COLORS[i]!])) as Record<
  Category,
  string
>;

const tick = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10.5,
  fill: 'var(--muted-foreground)',
  letterSpacing: '0.04em',
};

export const chartAxis = {
  tick,
  tickLine: false,
  axisLine: false,
  tickMargin: 10,
  minTickGap: 24,
} as const;

export const chartYAxis = { ...chartAxis, width: 36, tickMargin: 6 } as const;

export const chartGrid = { stroke: 'var(--chart-grid)', strokeDasharray: '2 5', vertical: false } as const;

export const chartLine = {
  type: 'monotone',
  strokeWidth: 2,
  dot: false,
  activeDot: { r: 4, strokeWidth: 2, stroke: 'var(--card)' },
} as const;

export const chartCursor = { stroke: 'var(--border)', strokeWidth: 1 } as const;

/**
 * The red threshold on a score chart: <ReferenceLine {...thresholdLine(70)} />.
 * Its label sits above the line at the left, clear of the latest points.
 */
export function thresholdLine(value: number) {
  return {
    y: value,
    stroke: 'var(--bad)',
    strokeDasharray: '4 4',
    strokeOpacity: 0.6,
    label: {
      value: `THRESHOLD ${value}`,
      position: 'insideBottomLeft',
      offset: 6,
      fill: 'var(--muted-foreground)',
      fontSize: 10,
      fontFamily: 'var(--font-mono)',
    },
  } as const;
}

/** Tooltip card: mono label, one row per series with its swatch, values in ink. */
export function ChartTooltip({
  active,
  payload,
  label,
  formatValue = (v) => String(v),
  formatLabel = (l) => String(l),
}: Partial<TooltipContentProps<number, string>> & {
  formatValue?: (value: number, name: string) => ReactNode;
  formatLabel?: (label: unknown) => ReactNode;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-xl border border-border bg-popover px-3 py-2.5 shadow-elevated">
      <p className="eyebrow mb-2">{formatLabel(label)}</p>
      <ul className="space-y-1">
        {payload.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 text-xs">
            <span className="size-2 rounded-[2px]" style={{ background: p.color }} aria-hidden="true" />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="tabular ml-auto pl-3 font-mono text-foreground">
              {formatValue(Number(p.value), String(p.name))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
