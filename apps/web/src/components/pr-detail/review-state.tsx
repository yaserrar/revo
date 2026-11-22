import { CloseCircle, Forbidden2, TickCircle } from 'iconsax-react';
import { SKIP_REASON_LABELS, type ReviewDto, type SkipReason } from '@revo/shared';
import { cn } from '~/lib/utils';

const SKIP_EXPLAINED: Record<SkipReason, string> = {
  draft:
    'Draft pull requests are not reviewed unless the repo settings say so. Mark it ready for review to get a score.',
  bot: 'Pull requests opened by bots (Dependabot, Renovate…) are skipped by default. Turn on "Review bot PRs" in the repo settings to include them.',
  budget:
    'The repo reached its monthly budget, so Revo did not call the model. Raise the budget in the repo settings to resume.',
  too_large: 'The change is above the size limits even after keeping the riskiest files.',
  no_reviewable_files:
    'Every changed file is ignored (lockfiles, generated code or the repo’s ignore patterns).',
  disabled: 'Reviews are turned off for this repo.',
  free_limit:
    'This account used its free reviews for the month, so Revo did not call the model. Add your own Anthropic API key to keep reviewing, or wait for the 1st.',
  free_paused:
    'Revo’s free reviews are paused until next month. Add your own Anthropic API key to keep reviewing.',
};

/** What to show instead of findings when the selected review has no score. */
export function ReviewState({ review }: { review: ReviewDto }) {
  if (review.status === 'queued' || review.status === 'running') {
    return (
      <Shell
        tone="accent"
        icon={
          <span className="relative flex size-3">
            <span className="absolute inset-0 animate-ping rounded-full bg-accent-brand opacity-60" />
            <span className="relative size-3 rounded-full bg-accent-brand" />
          </span>
        }
      >
        <h2 className="display text-3xl">{review.status === 'running' ? 'Reading the changes' : 'Queued'}</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Revo finds problems, then tries to disprove each one. Findings and the score appear here when it
          finishes, usually within two minutes. This page refreshes on its own.
        </p>
      </Shell>
    );
  }
  if (review.status === 'skipped') {
    const reason = review.skipReason;
    return (
      <Shell icon={<Forbidden2 className="size-5 text-muted-foreground" />}>
        <h2 className="display text-3xl">
          Skipped{reason ? `: ${SKIP_REASON_LABELS[reason].toLowerCase()}` : ''}
        </h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {reason ? SKIP_EXPLAINED[reason] : 'This commit was not reviewed.'}
        </p>
      </Shell>
    );
  }
  if (review.status === 'failed') {
    return (
      <Shell tone="bad" icon={<CloseCircle className="size-5 text-bad-ink" />}>
        <h2 className="display text-3xl">Revo couldn’t review this commit</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          The GitHub check was set to neutral, so nothing is blocked. Retries ran and stopped; you can review
          it again.
        </p>
        {review.error ? (
          <p className="mt-4 rounded-xl border border-bad/25 bg-card px-3 py-2 font-mono text-xs break-words text-bad-ink">
            {review.error}
          </p>
        ) : null}
      </Shell>
    );
  }
  return (
    <Shell tone="good" icon={<TickCircle className="size-5 text-good-ink" />}>
      <h2 className="display text-3xl">No problems found</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Revo read {review.filesReviewed} {review.filesReviewed === 1 ? 'file' : 'files'} and found nothing it
        could prove. Good to merge.
      </p>
    </Shell>
  );
}

function Shell({
  tone,
  icon,
  children,
}: {
  tone?: 'accent' | 'bad' | 'good';
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex flex-col items-start gap-4 rounded-3xl border p-6 sm:flex-row sm:p-8',
        tone === 'accent' && 'border-accent-brand/25 bg-accent-brand-soft/40',
        tone === 'bad' && 'border-bad/25 bg-bad-soft/50',
        tone === 'good' && 'border-good/25 bg-good-soft/50',
        !tone && 'border-dashed border-border',
      )}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-card ring-1 ring-border">
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
