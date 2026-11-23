'use client';

import { Brush2, LogoutCurve, Moon, Sun1 } from 'iconsax-react';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '~/components/ui/command';
import { NAV_ITEMS } from '~/constants/nav';
import { useUiStore } from '~/store/ui.store';

/**
 * ⌘K / Ctrl+K palette: navigation, theme, account. Feature pages add groups
 * through the `extra` slot (rendered before "Preferences").
 */
export function CommandMenu({ extra, showDevKit = false }: { extra?: ReactNode; showDevKit?: boolean }) {
  const open = useUiStore((s) => s.commandOpen);
  const setOpen = useUiStore((s) => s.setCommandOpen);
  const router = useRouter();
  const { setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(!useUiStore.getState().commandOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Command menu"
      description="Jump to a page or run a command"
    >
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go to">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.href}
              value={`go ${item.label}`}
              onSelect={() => run(() => router.push(item.href))}
            >
              <item.icon className="size-4" />
              {item.label}
            </CommandItem>
          ))}
          {showDevKit ? (
            <CommandItem value="go design kit" onSelect={() => run(() => router.push('/dev/kit'))}>
              <Brush2 className="size-4" />
              Design kit
            </CommandItem>
          ) : null}
        </CommandGroup>
        {extra}
        <CommandSeparator />
        <CommandGroup heading="Preferences">
          <CommandItem value="theme light" onSelect={() => run(() => setTheme('light'))}>
            <Sun1 className="size-4" />
            Light theme
          </CommandItem>
          <CommandItem value="theme dark" onSelect={() => run(() => setTheme('dark'))}>
            <Moon className="size-4" />
            Dark theme
          </CommandItem>
          <CommandItem value="sign out" onSelect={() => run(() => void signOut({ redirectTo: '/' }))}>
            <LogoutCurve className="size-4" />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
