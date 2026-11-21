import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PrDetailView } from '~/components/pr-detail/pr-detail-view';
import { requireUser } from '~/server/auth/session';

export const metadata: Metadata = { title: 'Pull request' };

export default async function PullRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, user] = await Promise.all([params, requireUser()]);
  return (
    <Suspense>
      <PrDetailView id={id} login={user.login} />
    </Suspense>
  );
}
