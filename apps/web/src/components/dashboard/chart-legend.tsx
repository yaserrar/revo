import { cn } from '~/lib/utils';

/** Legend for charts with two or more series: a square swatch and the name. */
export function ChartLegend({
  items,
  className,
}: {
  items: { key: string; label: string; color: string; dashed?: boolean }[];
  className?: string;
}) {
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-2', className)} aria-label="Legend">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn('h-2.5 w-2.5 rounded-[3px]', item.dashed && 'h-0.5 w-3.5 rounded-none')}
            style={{ background: item.color }}
            aria-hidden="true"
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
