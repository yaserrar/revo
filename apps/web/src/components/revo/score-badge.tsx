import { SCORE_LABEL_TEXT, scoreLabel } from '@revo/shared';
import { cn } from '~/lib/utils';
import { scoreDescription, scoreTone, TONE_CLASSES } from './tone';

/**
 * Compact score for tables and lists: a small arc in the score's tone and the
 * number in the serif. `showLabel` adds "Needs a look" etc.
 */
export function ScoreBadge({
  score,
  showLabel = false,
  className,
}: {
  score: number | null;
  showLabel?: boolean;
  className?: string;
}) {
  if (score === null) {
    return (
      <span
        className={cn('inline-flex items-center gap-2 text-muted-foreground', className)}
        aria-label="No score"
      >
        <svg viewBox="0 0 24 24" className="size-[22px]" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r="9.5"
            fill="none"
            stroke="var(--border)"
            strokeWidth="2.5"
            strokeDasharray="2 3"
          />
        </svg>
        <span className="display text-2xl leading-none">—</span>
      </span>
    );
  }
  const tone = TONE_CLASSES[scoreTone(score)];
  const c = 2 * Math.PI * 9.5;
  return (
    <span
      className={cn('inline-flex items-center gap-2', className)}
      aria-label={scoreDescription(score)}
      role="img"
    >
      <svg viewBox="0 0 24 24" className="size-[22px] -rotate-90" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="var(--border)" strokeWidth="2.5" />
        <circle
          cx="12"
          cy="12"
          r="9.5"
          fill="none"
          stroke="currentColor"
          className={tone.text}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
        />
      </svg>
      <span className="display tabular text-[1.6rem] leading-none">{score}</span>
      {showLabel ? (
        <span className={cn('eyebrow', tone.ink)}>{SCORE_LABEL_TEXT[scoreLabel(score)]}</span>
      ) : null}
    </span>
  );
}

/** "58 → 72": the change between two reviews of the same PR. */
export function ScoreDelta({ from, to, className }: { from: number; to: number; className?: string }) {
  const diff = to - from;
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 font-mono text-xs', className)}>
      <span className="text-muted-foreground">{from}</span>
      <span aria-hidden="true" className="text-muted-foreground">
        →
      </span>
      <span className="text-foreground">{to}</span>
      {diff !== 0 ? (
        <span className={diff > 0 ? 'text-good-ink' : 'text-bad-ink'}>
          ({diff > 0 ? '+' : '−'}
          {Math.abs(diff)})
        </span>
      ) : null}
    </span>
  );
}
