import { Clock, TickCircle } from 'iconsax-react';
import type { FindingDto } from '@revo/shared';
import { TONE_CLASSES } from '~/components/revo/tone';
import { cn } from '~/lib/utils';

const chip =
  'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[0.6875rem] leading-none whitespace-nowrap';
const short = (sha: string) => sha.slice(0, 7);

/**
 * What happened to a finding across pushes: fixed by a later commit, dismissed
 * by a person on GitHub, or still open since an earlier review.
 */
export function FindingStatusChip({ finding }: { finding: FindingDto }) {
  if (finding.resolution === 'fixed') {
    const t = TONE_CLASSES.good;
    return (
      <span className={cn(chip, t.soft, t.ink, t.border)}>
        <TickCircle className="size-3.5" />
        {finding.resolvedSha ? `Fixed in ${short(finding.resolvedSha)}` : 'Fixed'}
      </span>
    );
  }
  if (finding.resolution === 'dismissed') {
    return (
      <span
        className={cn(chip, 'border-border bg-muted text-muted-foreground')}
        title="A person resolved the thread on GitHub without changing the code: Revo will not raise it again on this PR"
      >
        Dismissed on GitHub
      </span>
    );
  }
  if (finding.openSince) {
    return (
      <span
        className={cn(chip, 'border-border bg-muted text-muted-foreground')}
        title="Found by an earlier review; the flagged code has not changed since"
      >
        <Clock className="size-3.5" />
        Open since {short(finding.openSince)}
      </span>
    );
  }
  return null;
}
