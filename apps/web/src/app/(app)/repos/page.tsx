import type { Metadata } from 'next';
import { AiAccessPanel } from '~/components/accounts/ai-access-panel';
import { PageHeader } from '~/components/layout/page-header';
import { ReposView } from '~/components/repos/repos-view';
import { env } from '~/server/config/env';
import { installUrlFor } from '~/server/modules/repos/install-url';

export const metadata: Metadata = { title: 'Repos' };

export default function ReposPage() {
  return (
    <>
      <PageHeader
        eyebrow="Repos"
        title="Where Revo reads."
        description="Every repository the GitHub App can see and you can access. Pause reviews, tune the model and rules, keep an eye on the monthly budget, and choose who pays for Claude."
      />
      <ReposView installUrl={installUrlFor(env.GITHUB_APP_SLUG)} />
      {/* Always rendered, so /repos#ai-access has a target before the accounts load. */}
      <div id="ai-access" className="mt-16 scroll-mt-28">
        <AiAccessPanel />
      </div>
    </>
  );
}
