'use client';

import { HambergerMenu, SearchNormal1 } from 'iconsax-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { UserDto } from '@revo/shared';
import { Wordmark } from '~/components/brand/wordmark';
import { Button } from '~/components/ui/button';
import { Kbd } from '~/components/ui/kbd';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '~/components/ui/sheet';
import { isNavActive, NAV_ITEMS } from '~/constants/nav';
import { cn } from '~/lib/utils';
import { useUiStore } from '~/store/ui.store';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

/**
 * Floating, centred pill navigation with a blurred backdrop. On phones the
 * links move into a sheet that drops from the top.
 */
export function TopNav({ user, installUrl }: { user: UserDto; installUrl: string | null }) {
  const pathname = usePathname();
  const setCommandOpen = useUiStore((s) => s.setCommandOpen);
  const mobileOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileOpen = useUiStore((s) => s.setMobileNavOpen);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center px-3 sm:top-4">
      <nav
        aria-label="Main"
        className="pointer-events-auto flex h-14 w-full max-w-[60rem] items-center gap-1 rounded-full border border-border/70 bg-glass pr-2 pl-4 shadow-float backdrop-blur-xl backdrop-saturate-150"
      >
        <Link
          href="/overview"
          className="mr-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Revo, overview"
        >
          <Wordmark />
        </Link>

        <ul className="mx-auto hidden items-center gap-0.5 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = isNavActive(item.href, pathname);
            return (
              <li key={item.href} className="relative">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative z-10 flex h-9 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'text-background' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute inset-0 -z-10 rounded-full bg-foreground"
                      transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                    />
                  ) : null}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="ml-auto flex items-center gap-1 md:ml-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCommandOpen(true)}
            className="hidden h-9 gap-2 border-border/80 bg-transparent pr-1.5 pl-3 text-muted-foreground lg:inline-flex"
          >
            <SearchNormal1 className="size-4" />
            <span className="text-[13px]">Search</span>
            <Kbd className="ml-2">⌘K</Kbd>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open command menu"
            onClick={() => setCommandOpen(true)}
          >
            <SearchNormal1 className="size-[18px]" />
          </Button>
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <div className="pl-1">
            <UserMenu user={user} installUrl={installUrl} />
          </div>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
                <HambergerMenu className="size-[18px]" />
              </Button>
            </SheetTrigger>
            <SheetContent side="top" className="px-4 pt-4 pb-6">
              <SheetHeader className="p-0 pr-10">
                <SheetTitle asChild>
                  <span>
                    <Wordmark />
                  </span>
                </SheetTitle>
                <SheetDescription className="eyebrow pt-2">Navigate</SheetDescription>
              </SheetHeader>
              <ul className="grid gap-1">
                {NAV_ITEMS.map((item) => {
                  const active = isNavActive(item.href, pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-2xl px-3 py-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          active ? 'bg-foreground text-background' : 'text-foreground hover:bg-muted',
                        )}
                      >
                        <item.icon className="size-5" />
                        <span className="display text-2xl">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between border-t border-border pt-4">
                <span className="eyebrow">Theme</span>
                <ThemeToggle withTooltip={false} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
