import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DesignKit } from '~/components/dev-kit/kit';
import { CommandMenu } from '~/components/layout/command-menu';
import { TopNav } from '~/components/layout/top-nav';
import { devKitEnabled } from '~/server/config/env';

export const metadata: Metadata = { title: 'Design kit' };

// Read REVO_ENABLE_DEV_KIT at request time, not at build time.
export const dynamic = 'force-dynamic';

/** The design system on one page. Hidden in production unless REVO_ENABLE_DEV_KIT=1. */
export default function DevKitPage() {
  if (!devKitEnabled) notFound();
  return (
    <div className="flex min-h-dvh flex-col">
      <TopNav
        user={{ id: 'kit', githubId: 0, login: 'maya-chen', name: 'Maya Chen', avatarUrl: null }}
        installUrl={null}
      />
      <CommandMenu showDevKit />
      <main className="page-frame flex-1 pt-28 sm:pt-32">
        <DesignKit />
      </main>
    </div>
  );
}
