import { Clock, CloseCircle, Forbidden2, TickCircle } from 'iconsax-react';
import {
  CATEGORY_LABELS,
  PR_STATE_LABELS,
  REVIEW_STATUS_LABELS,
  SEVERITY_LABELS,
  SEVERITIES,
  SKIP_REASON_LABELS,
  type Category,
  type PrState,
  type ReviewStatus,
  type Severity,
  type SeverityCounts,
  type SkipReason,
} from '@revo/shared';
import { cn } from '~/lib/utils';
import { SEVERITY_CLASSES, TONE_CLASSES } from './tone';

const chipBase =
  'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[0.6875rem] leading-none whitespace-nowrap';

/** BLOCKER / MAJOR / MINOR with a square marker in the severity colour. */
export function SeverityChip({
  severity,
  count,
  className,
}: {
  severity: Severity;
  count?: number;
  className?: string;
}) {
  const c = SEVERITY_CLASSES[severity];
  return (
    <span className={cn(chipBase, 'tracking-[0.1em] uppercase', c.soft, c.ink, c.border, className)}>
      <span className={cn('size-1.5 rounded-[2px]', c.dot)} aria-hidden="true" />
      {SEVERITY_LABELS[severity]}
      {count !== undefined ? <span className="tabular opacity-80">{count}</span> : null}
    </span>
  );
}

const SEVERITY_PLURALS = { blocker: 'blockers', major: 'majors', minor: 'minors' } as const;

/** "1 blocker, 0 majors, 2 minors": what the tally shows, for screen readers. */
export function severityCountsText(counts: SeverityCounts): string {
  return SEVERITIES.map((s) => `${counts[s]} ${counts[s] === 1 ? s : SEVERITY_PLURALS[s]}`).join(', ');
}

/** Confirmed findings per severity, zero counts faded. For PR rows. */
export function SeverityTally({ counts, className }: { counts: SeverityCounts; className?: string }) {
  const total = counts.blocker + counts.major + counts.minor;
  if (total === 0)
    return <span className={cn('font-mono text-xs text-muted-foreground', className)}>No findings</span>;
  return (
    <span className={cn('inline-flex items-center gap-3 font-mono text-xs', className)}>
      <span className="sr-only">{severityCountsText(counts)}</span>
      {SEVERITIES.map((s) => (
        <span
          key={s}
          className={cn('inline-flex items-center gap-1.5', counts[s] === 0 && 'opacity-35')}
          aria-hidden="true"
        >
          <span className={cn('size-2 rounded-[2px]', SEVERITY_CLASSES[s].dot)} />
          <span className="tabular text-foreground">{counts[s]}</span>
        </span>
      ))}
    </span>
  );
}

/** Hairline pill with the category slug. */
export function CategoryChip({ category, className }: { category: Category; className?: string }) {
  return (
    <span
      className={cn(chipBase, 'border-border bg-transparent text-ink-soft', className)}
      title={CATEGORY_LABELS[category]}
    >
      <span className="text-muted-foreground" aria-hidden="true">
        #
      </span>
      {category}
    </span>
  );
}

const PR_STATE_DOT: Record<PrState, string> = {
  open: 'bg-good',
  merged: 'bg-accent-brand',
  closed: 'bg-muted-foreground',
};

export function PrStateChip({
  state,
  draft = false,
  className,
}: {
  state: PrState;
  draft?: boolean;
  className?: string;
}) {
  return (
    <span className={cn(chipBase, 'border-border bg-card text-foreground', className)}>
      <span className={cn('size-1.5 rounded-full', PR_STATE_DOT[state])} aria-hidden="true" />
      {draft && state === 'open' ? 'Draft' : PR_STATE_LABELS[state]}
    </span>
  );
}

export function ReviewStatusChip({
  status,
  skipReason,
  className,
}: {
  status: ReviewStatus;
  skipReason?: SkipReason | null;
  className?: string;
}) {
  const label =
    status === 'skipped' && skipReason ? SKIP_REASON_LABELS[skipReason] : REVIEW_STATUS_LABELS[status];
  if (status === 'running' || status === 'queued') {
    return (
      <span
        className={cn(
          chipBase,
          'border-accent-brand/30 bg-accent-brand-soft text-accent-brand-ink',
          className,
        )}
      >
        {status === 'running' ? (
          <span className="relative flex size-1.5" aria-hidden="true">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent-brand opacity-60" />
            <span className="relative size-1.5 rounded-full bg-accent-brand" />
          </span>
        ) : (
          <Clock className="size-3.5" />
        )}
        {label}
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span
        className={cn(
          chipBase,
          TONE_CLASSES.bad.soft,
          TONE_CLASSES.bad.ink,
          TONE_CLASSES.bad.border,
          className,
        )}
      >
        <CloseCircle className="size-3.5" />
        {label}
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className={cn(chipBase, 'border-border bg-muted text-muted-foreground', className)}>
        <Forbidden2 className="size-3.5" />
        {label}
      </span>
    );
  }
  return (
    <span className={cn(chipBase, 'border-border bg-card text-muted-foreground', className)}>
      <TickCircle className="size-3.5" />
      {label}
    </span>
  );
}

/** The GitHub check: green (passed), red (failed) or neutral (no score). */
export function CheckChip({ passed, className }: { passed: boolean | null; className?: string }) {
  if (passed === null) {
    return (
      <span className={cn(chipBase, 'border-border bg-muted text-muted-foreground', className)}>
        Check neutral
      </span>
    );
  }
  const t = TONE_CLASSES[passed ? 'good' : 'bad'];
  return (
    <span className={cn(chipBase, t.soft, t.ink, t.border, className)}>
      {passed ? <TickCircle className="size-3.5" /> : <CloseCircle className="size-3.5" />}
      {passed ? 'Check passed' : 'Check failed'}
    </span>
  );
}
