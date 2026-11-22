import { CategoryChip, SeverityChip } from '~/components/revo/chips';
import { ScoreDial } from '~/components/revo/score-dial';
import { cn } from '~/lib/utils';

/** A sample review (made-up repo): score dial, the formula behind it, one finding. */
export function ExampleReview({ className }: { className?: string }) {
  return (
    <aside aria-label="Example review comment" className={cn('relative', className)}>
      <div className="rounded-[2rem] border border-border bg-card p-6 shadow-elevated sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow">northwind-labs/storefront · #241</p>
            <p className="mt-2 truncate text-sm font-medium">Apply promo codes at checkout</p>
          </div>
          <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground">58 → 72</span>
        </div>
        <div className="mt-8 flex justify-center">
          <ScoreDial score={72} size="lg" />
        </div>
        <p className="mt-5 mb-7 text-center font-mono text-[0.6875rem] text-muted-foreground">
          100 − 24 <span className="text-sev-major-ink">2 major</span> − 4{' '}
          <span className="text-ink-soft">1 minor</span> = <span className="text-foreground">72</span>
        </p>
        <div className="space-y-4 border-t border-border pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityChip severity="major" />
            <CategoryChip category="bug" />
            <span className="font-mono text-xs text-muted-foreground">src/lib/pricing.ts · line 44</span>
            <span className="eyebrow ml-auto hidden sm:inline">1 of 3</span>
          </div>
          <p className="display text-2xl leading-tight">Discount applied after tax</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A $20 code on a $100 cart with 20% tax charges $100 instead of $96. Subtract the promo before
            computing tax.
          </p>
        </div>
        <p className="mt-6 border-t border-border pt-4 font-mono text-[0.6875rem] text-muted-foreground">
          Reviewed 9 files · Claude Sonnet 5.5 · 41 s · $0.18
        </p>
      </div>
    </aside>
  );
}
