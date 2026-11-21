'use client';

import type { ReviewDto } from '@revo/shared';
import { ReviewStatusChip } from '~/components/revo/chips';
import { ScoreBadge, ScoreDelta } from '~/components/revo/score-badge';
import { formatRelative, shortSha } from '~/lib/format';
import { cn } from '~/lib/utils';

/** Every review of the PR, newest first; selecting one opens it. */
export function ReviewHistory({
  reviews,
  selectedId,
  onSelect,
}: {
  reviews: ReviewDto[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const now = new Date();
  return (
    <ol className="relative space-y-1">
      <span aria-hidden="true" className="absolute top-4 bottom-4 left-[1.0625rem] w-px bg-border" />
      {reviews.map((r, i) => {
        const older = reviews.slice(i + 1).find((x) => x.status === 'done' && x.score !== null);
        const selected = r.id === selectedId;
        return (
          <li key={r.id} className="relative">
            <button
              type="button"
              onClick={() => onSelect(r.id)}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'flex w-full items-center gap-3 rounded-2xl py-2.5 pr-3 pl-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'bg-foreground text-background' : 'hover:bg-paper-sunken',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'relative z-10 size-[0.875rem] shrink-0 rounded-full border-2 ml-[0.625rem]',
                  selected ? 'border-background bg-accent-brand' : 'border-border bg-card',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-mono text-xs">
                  <span>{shortSha(r.headSha)}</span>
                  {r.trigger === 'manual' ? (
                    <span className={cn('eyebrow text-[0.5625rem]', selected && 'text-background/70')}>
                      manual
                    </span>
                  ) : null}
                  {i === 0 ? (
                    <span
                      className={cn(
                        'eyebrow text-[0.5625rem]',
                        selected ? 'text-background/70' : 'text-accent-brand-ink',
                      )}
                    >
                      latest
                    </span>
                  ) : null}
                </span>
                <span
                  className={cn(
                    'mt-1 block font-mono text-[0.6875rem]',
                    selected ? 'text-background/70' : 'text-muted-foreground',
                  )}
                >
                  {formatRelative(r.createdAt, now)}
                  {r.status === 'done' && older?.score != null && r.score !== null ? (
                    <>
                      {' · '}
                      <ScoreDelta
                        from={older.score}
                        to={r.score}
                        className={cn('text-[0.6875rem]', selected && '[&_span]:text-background/80')}
                      />
                    </>
                  ) : null}
                </span>
              </span>
              {r.status === 'done' ? (
                <ScoreBadge score={r.score} className="shrink-0" />
              ) : (
                <ReviewStatusChip status={r.status} skipReason={r.skipReason} className="shrink-0" />
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
