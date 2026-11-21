import { Wallet3 } from 'iconsax-react';
import Link from 'next/link';
import { formatUsd } from '~/lib/format';
import { cn } from '~/lib/utils';
import type { BudgetDto } from '~/types/repo';

function nextMonthLabel(now = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format(next);
}

/**
 * Spec 11.6: when a repo's monthly budget is reached, reviews stop there and
 * the dashboard says so. One banner lists every such repo.
 */
export function BudgetBanner({
  budgets,
  showSettingsLink = true,
  className,
}: {
  budgets: BudgetDto[];
  showSettingsLink?: boolean;
  className?: string;
}) {
  if (budgets.length === 0) return null;
  const one = budgets.length === 1 ? budgets[0]! : null;
  return (
    <div
      role="status"
      className={cn(
        'relative flex flex-col gap-4 overflow-hidden rounded-3xl border border-bad/30 bg-bad-soft px-5 py-4 sm:flex-row sm:items-center sm:px-6',
        className,
      )}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-bad" />
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-card text-bad-ink ring-1 ring-bad/25">
        <Wallet3 className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="eyebrow text-bad-ink">Monthly budget reached</p>
        <p className="mt-1.5 text-sm leading-relaxed text-foreground">
          {one ? (
            <>
              <span className="font-mono text-[13px]">{one.repoFullName}</span> spent{' '}
              {formatUsd(one.spentUsd)} of {formatUsd(one.budgetUsd)}.
            </>
          ) : (
            <>
              {budgets.length} repos are over budget:{' '}
              <span className="font-mono text-[13px]">{budgets.map((b) => b.repoFullName).join(', ')}</span>.
            </>
          )}{' '}
          Reviews are paused there until {nextMonthLabel()}, or until the budget is raised.
        </p>
      </div>
      {showSettingsLink ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          {budgets.slice(0, 2).map((b) => (
            <Link
              key={b.repoId}
              href={`/repos/${b.repoId}/settings#budget`}
              className="inline-flex h-8 items-center rounded-full border border-border bg-card px-3 text-[13px] font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {one ? 'Raise the budget' : `${b.repoFullName.split('/')[1]} settings`}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
