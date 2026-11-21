'use client';

import { Status } from 'iconsax-react';
import { useState } from 'react';
import { SCORE_BANDS, SCORE_LABEL_TEXT } from '@revo/shared';
import { Button } from '~/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';
import { Slider } from '~/components/ui/slider';
import { cn } from '~/lib/utils';

type Range = { min: number | null; max: number | null };

/** The three score bands (spec 9) as presets: [min, max]. */
const PRESETS = SCORE_BANDS.map((band, i) => ({
  label: SCORE_LABEL_TEXT[band.label],
  min: band.min,
  max: i === 0 ? 100 : SCORE_BANDS[i - 1]!.min - 1,
}));

export function ScoreFilter({ value, onChange }: { value: Range; onChange: (range: Range) => void }) {
  const active = value.min !== null || value.max !== null;
  const [draft, setDraft] = useState<[number, number]>([value.min ?? 0, value.max ?? 100]);

  return (
    <Popover onOpenChange={(open) => open && setDraft([value.min ?? 0, value.max ?? 100])}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn('h-9 gap-1.5 border-dashed', active && 'border-solid border-foreground/30')}
        >
          <Status className="size-4" />
          Score
          {active ? (
            <span className="ml-1 border-l border-border pl-2 font-mono text-[0.6875rem]">
              {value.min ?? 0}–{value.max ?? 100}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-5" align="start">
        <div className="flex items-baseline justify-between">
          <p className="eyebrow">Score range</p>
          <p className="display tabular text-2xl" aria-live="polite">
            {draft[0]}–{draft[1]}
          </p>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={draft}
          onValueChange={(v) => setDraft([v[0] ?? 0, v[1] ?? 100])}
          onValueCommit={(v) => {
            const [min = 0, max = 100] = v;
            onChange({ min: min === 0 ? null : min, max: max === 100 ? null : max });
          }}
          aria-label="Score range"
        />
        <div className="grid gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setDraft([p.min, p.max]);
                onChange({ min: p.min === 0 ? null : p.min, max: p.max === 100 ? null : p.max });
              }}
              className="flex items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {p.label}
              <span className="font-mono text-xs text-muted-foreground">
                {p.min}–{p.max}
              </span>
            </button>
          ))}
        </div>
        {active ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => onChange({ min: null, max: null })}
          >
            Clear score range
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
