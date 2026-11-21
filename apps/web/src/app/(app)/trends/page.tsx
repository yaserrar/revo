import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '~/components/layout/page-header';
import { TrendsView } from '~/components/trends/trends-view';
import { env } from '~/server/config/env';
import { installUrlFor } from '~/server/modules/repos/install-url';

export const metadata: Metadata = { title: 'Trends' };

export default function TrendsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Trends"
        title="Is it getting better?"
        description="Scores per repo, what kind of problems Revo finds, how often it is right, and what it costs."
      />
      <Suspense>
        <TrendsView installUrl={installUrlFor(env.GITHUB_APP_SLUG)} />
      </Suspense>
    </>
  );
}
