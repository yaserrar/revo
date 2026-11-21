import type { ReactNode } from 'react';
import { CommandSearch } from '~/components/command/command-search';
import { AppShell } from '~/components/layout/app-shell';
import { requireUser } from '~/server/auth/session';
import { devKitEnabled, env } from '~/server/config/env';
import { installUrlFor } from '~/server/modules/repos/install-url';

/** Every dashboard page: signed-in users only (the proxy check is optimistic). */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const installUrl = installUrlFor(env.GITHUB_APP_SLUG);
  return (
    <AppShell user={user} installUrl={installUrl} showDevKit={devKitEnabled} commandExtra={<CommandSearch />}>
      {children}
    </AppShell>
  );
}
