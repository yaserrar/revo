'use client';

import { useId } from 'react';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';
import { cn } from '~/lib/utils';

/** Tiny trend line with a soft fill, no axes. Decorative: pair it with the number it summarises. */
export function Sparkline({
  data,
  color = 'var(--chart-1)',
  domain,
  className,
}: {
  data: number[];
  color?: string;
  domain?: [number, number];
  className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const points = data.map((value, i) => ({ i, value }));
  return (
    // Decorative: hidden from assistive tech and out of the tab order (inert).
    <div className={cn('h-12 w-full', className)} aria-hidden="true" inert>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 4, right: 2, bottom: 2, left: 2 }}
          accessibilityLayer={false}
          tabIndex={-1}
        >
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={domain ?? ['dataMin - 2', 'dataMax + 2']} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#spark-${id})`}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
