import { ArrowRight2, TickCircle } from 'iconsax-react';
import { SeverityChip } from '~/components/revo/chips';
import { formatLines } from '~/lib/format';
import type { FixedFindingDto } from '~/types/review';

/**
 * Problems an earlier review found that this commit fixed (their flagged
 * lines changed). Revo resolved their threads on GitHub; each opens the review
 * that found it.
 */
export function FixedFindings({
  items,
  onOpen,
}: {
  items: FixedFindingDto[];
  onOpen: (reviewId: string, findingId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section
      aria-labelledby="fixed-heading"
      className="rounded-3xl border border-good/30 bg-good-soft/40 px-5 py-5 sm:px-6"
    >
      <h2 id="fixed-heading" className="flex items-center gap-2 font-medium text-good-ink">
        <TickCircle className="size-5" />
        Fixed by this commit · {items.length}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Found by an earlier review; the flagged lines changed, so Revo resolved their threads on GitHub.
      </p>
      <ul className="mt-4 space-y-2">
        {items.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onOpen(f.reviewId, f.id)}
              className="group grid w-full min-w-0 gap-1.5 rounded-2xl bg-card px-4 py-3 text-left shadow-card transition-colors outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring sm:flex sm:items-center sm:gap-3"
            >
              <span className="flex min-w-0 items-start gap-2 sm:flex-1 sm:items-center">
                <SeverityChip severity={f.severity} className="opacity-80" />
                <span className="min-w-0 font-medium text-ink-soft line-through decoration-good/60 decoration-1">
                  {f.title}
                </span>
              </span>
              <span className="flex min-w-0 items-center gap-1 font-mono text-[0.6875rem] text-muted-foreground sm:max-w-[45%]">
                <span className="min-w-0 truncate">
                  {f.file} · {formatLines(f.lineStart, f.lineEnd)}
                </span>
                <ArrowRight2 className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
