'use client';

import { ArrowDown2, ShieldTick } from 'iconsax-react';
import { useState } from 'react';
import { languageForPath, type FindingDto } from '@revo/shared';
import { CategoryChip, SeverityChip } from '~/components/revo/chips';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible';
import { formatLines } from '~/lib/format';
import { cn } from '~/lib/utils';
import { Markdown } from './markdown';

/**
 * Spec 11.4: findings the second pass disproved, collapsed by default, each
 * with the reason. Builds trust and helps debugging.
 */
export function RejectedFindings({ items }: { items: FindingDto[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-3xl border border-dashed border-border"
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-4 rounded-3xl px-5 py-4 text-left transition-colors outline-none hover:bg-paper-sunken focus-visible:ring-2 focus-visible:ring-ring sm:px-6">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-paper-sunken text-muted-foreground ring-1 ring-border">
          <ShieldTick className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Rejected by verification · {items.length}</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            The second pass tried to disprove every finding. These did not survive, so they were never posted.
          </span>
        </span>
        <ArrowDown2
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
        <ol className="space-y-3 px-5 pb-5 sm:px-6">
          {items.map((f) => (
            <li key={f.id} className="rounded-2xl bg-paper-sunken p-4">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityChip severity={f.severity} className="opacity-70" />
                <CategoryChip category={f.category} />
                <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                  {f.file} · {formatLines(f.lineStart, f.lineEnd)}
                </span>
              </div>
              <p className="mt-3 font-medium text-ink-soft line-through decoration-border decoration-1">
                {f.title}
              </p>
              <Markdown
                source={f.explanation}
                lang={languageForPath(f.file)}
                className="mt-1 text-sm text-muted-foreground"
              />
              {f.rejectReason ? (
                <div className="mt-3 border-l-2 border-accent-brand pl-3">
                  <p className="eyebrow text-accent-brand-ink">Why it was rejected</p>
                  <Markdown
                    source={f.rejectReason}
                    lang={languageForPath(f.file)}
                    className="mt-1.5 text-sm text-foreground"
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
