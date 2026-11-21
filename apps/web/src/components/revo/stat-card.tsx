import type { ReactNode } from 'react';
import { cn } from '~/lib/utils';

/**
 * Bento tile: mono label, big serif figure, an optional delta, and a slot for
 * a sparkline, meter or note. Size it with grid spans from the page.
 */
export function StatCard({
  label,
  value,
  unit,
  delta,
  icon,
  footnote,
  children,
  emphasis = false,
  className,
}: {
  label: string;
  value: ReactNode;
  /** Small mono suffix after the number (e.g. "/ 100", "%"). */
  unit?: string;
  delta?: ReactNode;
  icon?: ReactNode;
  footnote?: ReactNode;
  children?: ReactNode;
  /** Ink-filled variant for the one tile that leads the grid. */
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'group relative flex min-w-0 flex-col overflow-hidden rounded-3xl border p-5 sm:p-6',
        emphasis
          ? 'border-transparent bg-foreground text-background'
          : 'border-border bg-card text-card-foreground shadow-card',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        {/* One line always ("REVIEWED · 7D" never splits); the icon gives way on phones. */}
        <h3 className={cn('eyebrow whitespace-nowrap', emphasis && 'text-background/70')}>{label}</h3>
        {icon ? (
          <span className={cn('text-muted-foreground max-sm:hidden', emphasis && 'text-background/70')}>
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-6 flex items-baseline gap-2">
        <span
          className={cn(
            'display tabular leading-[0.9]',
            emphasis ? 'text-7xl sm:text-[7.5rem]' : 'text-6xl sm:text-[4.25rem]',
          )}
        >
          {value}
        </span>
        {unit ? (
          <span className={cn('font-mono text-sm text-muted-foreground', emphasis && 'text-background/70')}>
            {unit}
          </span>
        ) : null}
      </div>
      {delta ? <div className="mt-2">{delta}</div> : null}
      {children ? <div className="mt-auto pt-5">{children}</div> : null}
      {footnote ? (
        <p
          className={cn(
            'mt-4 border-t pt-3 font-mono text-[0.6875rem] text-muted-foreground',
            emphasis ? 'border-background/15 text-background/70' : 'border-border',
          )}
        >
          {footnote}
        </p>
      ) : null}
    </section>
  );
}

/** "+4 vs last week" with an arrow, toned by whether up is good. */
export function Delta({
  value,
  suffix = '',
  caption,
  upIsGood = true,
  className,
}: {
  value: number;
  suffix?: string;
  caption?: string;
  upIsGood?: boolean;
  className?: string;
}) {
  const good = value === 0 ? null : value > 0 === upIsGood;
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-mono text-xs', className)}>
      <span className={cn(good === null ? 'text-muted-foreground' : good ? 'text-good-ink' : 'text-bad-ink')}>
        {value > 0 ? '↑' : value < 0 ? '↓' : '→'} {value > 0 ? '+' : value < 0 ? '−' : ''}
        {Math.abs(value)}
        {suffix}
      </span>
      {caption ? <span className="text-muted-foreground">{caption}</span> : null}
    </span>
  );
}

/**
 * Thin meter. `kind="budget"` turns warn from 80% and bad at 100% (spend
 * against a limit); `kind="rate"` stays in the accent (a ratio like precision).
 */
export function Meter({
  value,
  max,
  label,
  kind = 'rate',
  className,
}: {
  value: number;
  max: number;
  label: string;
  kind?: 'rate' | 'budget';
  className?: string;
}) {
  const ratio = max > 0 ? Math.min(1, value / max) : 1;
  const tone =
    kind === 'rate'
      ? 'bg-accent-brand'
      : ratio >= 1
        ? 'bg-bad'
        : ratio >= 0.8
          ? 'bg-warn'
          : 'bg-accent-brand';
  return (
    <div className={cn('space-y-2', className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-700 ease-out', tone)}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}
