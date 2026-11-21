'use client';

import { Calendar1 } from 'iconsax-react';
import { useState } from 'react';
import { Button } from '~/components/ui/button';
import { Calendar } from '~/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '~/components/ui/popover';
import { formatDate } from '~/lib/format';
import { cn } from '~/lib/utils';

/** Popover + Calendar date picker (never a native date input). */
export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
  label,
  disabled,
  className,
}: {
  value: Date | undefined;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  /** Accessible name of the trigger. */
  label: string;
  disabled?: (date: Date) => boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          aria-label={label}
          className={cn(
            'w-full justify-start gap-2 font-normal sm:w-56',
            !value && 'text-muted-foreground',
            className,
          )}
        >
          <Calendar1 className="size-4" />
          {value ? formatDate(value) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={(d) => {
            onChange(d);
            setOpen(false);
          }}
          disabled={disabled}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}
