'use client';

import { AddCircle } from 'iconsax-react';
import type { ReactNode } from 'react';
import { Button } from '~/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '~/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';
import { cn } from '~/lib/utils';

export type FacetOption = { value: string; label: string; icon?: ReactNode };

/** Multi-select filter in a popover (searchable when there are many options). */
export function FacetFilter({
  title,
  options,
  selected,
  onChange,
  searchable = false,
}: {
  title: string;
  options: FacetOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
}) {
  const set = new Set(selected);
  const toggle = (value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value));
  };
  const chosen = options.filter((o) => set.has(o.value));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-9 gap-1.5 border-dashed',
            chosen.length > 0 && 'border-solid border-foreground/30',
          )}
        >
          <AddCircle className={cn('size-4', chosen.length > 0 && 'rotate-45 text-muted-foreground')} />
          {title}
          {chosen.length > 0 ? (
            <span className="ml-1 flex items-center gap-1 border-l border-border pl-2">
              {chosen.length > 2 ? (
                <span className="rounded-full bg-foreground px-1.5 font-mono text-[0.6875rem] text-background">
                  {chosen.length}
                </span>
              ) : (
                chosen.map((o) => (
                  <span
                    key={o.value}
                    className="max-w-28 truncate rounded-full bg-muted px-2 font-mono text-[0.6875rem]"
                  >
                    {o.label}
                  </span>
                ))
              )}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          {searchable ? <CommandInput placeholder={title} /> : null}
          <CommandList>
            <CommandEmpty>No match.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => toggle(o.value)}
                  data-checked={set.has(o.value)}
                >
                  {o.icon}
                  <span className="truncate">{o.label}</span>
                  {set.has(o.value) ? <span className="sr-only">(selected)</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
            {chosen.length > 0 ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => onChange([])} className="justify-center text-muted-foreground">
                    Clear {title.toLowerCase()}
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
