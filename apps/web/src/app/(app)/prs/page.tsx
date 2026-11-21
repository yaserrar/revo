import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PageHeader } from '~/components/layout/page-header';
import { PrsView } from '~/components/prs/prs-view';
import { env } from '~/server/config/env';
import { installUrlFor } from '~/server/modules/repos/install-url';

export const metadata: Metadata = { title: 'Pull requests' };

export default function PullRequestsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Pull requests"
        title="Every PR, scored."
        description="The latest review of each pull request on your repos. Filter by repo, author, state or score; the URL keeps the view."
      />
      <Suspense>
        <PrsView installUrl={installUrlFor(env.GITHUB_APP_SLUG)} />
      </Suspense>
    </>
  );
}
