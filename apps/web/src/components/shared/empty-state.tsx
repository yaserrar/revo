import type { ComponentType, ReactNode } from 'react';
import { cn } from '~/lib/utils';

type IconType = ComponentType<{ className?: string }>;

/** Every list has one: icon in a ringed disc, serif title, short guidance, optional action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: IconType;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-3xl border border-dashed border-border px-6 py-14 text-center',
        className,
      )}
    >
      <div className="relative mb-5 grid size-14 place-items-center rounded-full bg-paper-sunken ring-1 ring-border">
        <span
          className="absolute inset-[-6px] rounded-full border border-dashed border-border"
          aria-hidden="true"
        />
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <h3 className="display text-2xl">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-sm text-sm text-pretty text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
