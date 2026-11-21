'use client';

import { Refresh2, Warning2 } from 'iconsax-react';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

/** Inline error with a retry, for failed queries. */
export function ErrorState({
  title = 'This did not load',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center rounded-3xl border border-bad/30 bg-bad-soft/50 px-6 py-10 text-center',
        className,
      )}
    >
      <Warning2 className="mb-3 size-6 text-bad-ink" />
      <h3 className="display text-2xl">{title}</h3>
      {message ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-5" onClick={onRetry}>
          <Refresh2 className="size-4" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
