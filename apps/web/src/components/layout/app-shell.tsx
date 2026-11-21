import type { ReactNode } from 'react';
import type { UserDto } from '@revo/shared';
import { CommandMenu } from './command-menu';
import { TopNav } from './top-nav';

/** Signed-in frame: floating nav, editorial content column, quiet footer. */
export function AppShell({
  user,
  installUrl,
  showDevKit,
  commandExtra,
  children,
}: {
  user: UserDto;
  installUrl: string | null;
  showDevKit: boolean;
  /** Extra ⌘K groups (rendered inside the command list). */
  commandExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#content"
        className="sr-only z-50 rounded-full bg-foreground px-4 py-2 text-background focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <TopNav user={user} installUrl={installUrl} />
      <CommandMenu showDevKit={showDevKit} extra={commandExtra} />
      <main id="content" className="page-frame flex-1 pt-28 pb-20 sm:pt-32">
        {children}
      </main>
      <footer className="page-frame flex flex-wrap items-center justify-between gap-2 border-t border-border py-6">
        <span className="eyebrow">Revo · reviews that prove their point</span>
        <span className="eyebrow hidden sm:inline">Score = 100 − 30·blocker − 12·major − 4·minor</span>
      </footer>
    </div>
  );
}
