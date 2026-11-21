'use client';

import { ExportSquare, LogoutCurve, Moon, Sun1 } from 'iconsax-react';
import { signOut } from 'next-auth/react';
import { useTheme } from 'next-themes';
import type { UserDto } from '@revo/shared';
import { UserAvatar } from '~/components/shared/user-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';

export function UserMenu({ user, installUrl }: { user: UserDto; installUrl: string | null }) {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label="Account menu"
      >
        <UserAvatar login={user.login} name={user.name} src={user.avatarUrl} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-1 py-2">
          <span className="truncate text-sm font-medium text-foreground">{user.name ?? user.login}</span>
          <span className="truncate font-mono text-xs font-normal text-muted-foreground">@{user.login}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {installUrl ? (
          <DropdownMenuItem asChild>
            <a href={installUrl} target="_blank" rel="noreferrer">
              <ExportSquare className="size-4" />
              Install on GitHub
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
          <Sun1 className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
          {resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut({ redirectTo: '/sign-in' })}>
          <LogoutCurve className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
