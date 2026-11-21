import type { ReactNode } from 'react';
import { cn } from '~/lib/utils';

/**
 * Editorial page header: mono eyebrow, large serif title, a calm description,
 * actions on the right, and an optional meta row under a hairline.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-10 sm:mb-12', className)}>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-3">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1 className="display text-[2.6rem] leading-[1.02] text-balance sm:text-6xl">{title}</h1>
          {description ? (
            <p className="max-w-2xl text-[15px] leading-relaxed text-pretty text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? (
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-4">
          {meta}
        </div>
      ) : null}
    </header>
  );
}

/** One "LABEL value" pair for the PageHeader meta row. */
export function MetaItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="eyebrow">{label}</span>
      <span className="font-mono text-xs text-foreground">{children}</span>
    </div>
  );
}
