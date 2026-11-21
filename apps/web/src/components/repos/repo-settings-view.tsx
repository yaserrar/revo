'use client';

import { ArrowLeft, ExportSquare } from 'iconsax-react';
import Link from 'next/link';
import { modelName } from '@revo/shared';
import { MetaItem, PageHeader } from '~/components/layout/page-header';
import { ErrorState } from '~/components/shared/error-state';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { useRepoSettings } from '~/hooks/repos';
import { formatDateTime, formatUsd } from '~/lib/format';
import { ApiError } from '~/services/api/client';
import { RepoSettingsForm } from './repo-settings-form';

export function RepoSettingsView({ id }: { id: string }) {
  const { data, isPending, isError, error, refetch } = useRepoSettings(id);

  const back = (
    <Link
      href="/repos"
      className="eyebrow mb-8 inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <ArrowLeft className="size-3.5" />
      Repos
    </Link>
  );

  if (isPending)
    return (
      <div aria-busy="true" aria-label="Loading settings" className="space-y-8">
        {back}
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-48 rounded-3xl" />
      </div>
    );
  if (isError) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <>
        {back}
        <ErrorState
          title={missing ? 'Repo not found' : 'This did not load'}
          message={missing ? 'It does not exist, or you cannot access it on GitHub.' : error.message}
          onRetry={missing ? undefined : () => void refetch()}
        />
      </>
    );
  }

  return (
    <>
      {back}
      <PageHeader
        eyebrow={`${data.repo.owner} · settings`}
        title={data.repo.name}
        description="Changes apply to the next review. Reviews already posted keep the settings they ran with."
        actions={
          <Button asChild variant="outline">
            <a href={data.repo.url} target="_blank" rel="noreferrer">
              Open on GitHub
              <ExportSquare className="size-4" />
            </a>
          </Button>
        }
        meta={
          <>
            <MetaItem label="Model">{modelName(data.settings.model)}</MetaItem>
            <MetaItem label="Spent">
              {formatUsd(data.budget.spentUsd)} / {formatUsd(data.budget.budgetUsd)}
            </MetaItem>
            <MetaItem label="Saved">{formatDateTime(data.settings.updatedAt)}</MetaItem>
          </>
        }
      />
      <RepoSettingsForm page={data} />
    </>
  );
}
