import type { ReactNode } from 'react';
import { cn } from '~/lib/utils';

/**
 * A titled card on the editorial grid: mono eyebrow, optional serif heading,
 * actions on the right, hairline under the header when `divided`.
 */
export function Panel({
  eyebrow,
  title,
  actions,
  children,
  divided = false,
  className,
  bodyClassName,
  as: Tag = 'section',
  labelledBy,
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  divided?: boolean;
  className?: string;
  bodyClassName?: string;
  as?: 'section' | 'div' | 'aside';
  labelledBy?: string;
}) {
  const hasHeader = Boolean(eyebrow || title || actions);
  return (
    <Tag
      aria-labelledby={labelledBy}
      className={cn('min-w-0 rounded-3xl border border-border bg-card shadow-card', className)}
    >
      {hasHeader ? (
        <header
          className={cn(
            'flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-5 pt-5 sm:px-6 sm:pt-6',
            divided ? 'border-b border-border pb-4' : 'pb-1',
          )}
        >
          <div className="min-w-0 space-y-2">
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            {title ? (
              <h2 id={labelledBy} className="display text-[1.75rem] leading-tight sm:text-3xl">
                {title}
              </h2>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn('p-5 sm:p-6', hasHeader && 'pt-4 sm:pt-5', bodyClassName)}>{children}</div>
    </Tag>
  );
}
