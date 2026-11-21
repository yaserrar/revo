import type { Metadata } from 'next';
import { PageHeader } from '~/components/layout/page-header';
import { OverviewView } from '~/components/overview/overview-view';
import { requireUser } from '~/server/auth/session';
import { env } from '~/server/config/env';
import { installUrlFor } from '~/server/modules/repos/install-url';

export const metadata: Metadata = { title: 'Overview' };

function greeting(hour: number): string {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default async function OverviewPage() {
  const user = await requireUser();
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(
    now,
  );
  return (
    <>
      <PageHeader
        eyebrow={`Overview · ${today}`}
        title={`${greeting(now.getHours())}, ${user.name?.split(' ')[0] ?? user.login}.`}
        description="Every reviewed pull request, its score, what it cost, and how often Revo was right."
      />
      <OverviewView installUrl={installUrlFor(env.GITHUB_APP_SLUG)} />
    </>
  );
}
