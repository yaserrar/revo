'use client';

import { Moon, Sun1 } from 'iconsax-react';
import { useTheme } from 'next-themes';
import { Button } from '~/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';

/** Switches between light and dark. Both icons render; CSS shows the right one, so no hydration flash. */
export function ThemeToggle({ withTooltip = true }: { withTooltip?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';
  const button = (
    <Button variant="ghost" size="icon" aria-label="Toggle colour theme" onClick={() => setTheme(next)}>
      <Sun1 className="size-[18px] dark:hidden" />
      <Moon className="hidden size-[18px] dark:block" />
    </Button>
  );
  if (!withTooltip) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>Light or dark</TooltipContent>
    </Tooltip>
  );
}
