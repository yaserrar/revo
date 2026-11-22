'use client';

import { Add, Key, Lock, Setting2 } from 'iconsax-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { modelName } from '@revo/shared';
import { BudgetBanner } from '~/components/dashboard/budget-banner';
import { InstallCta } from '~/components/dashboard/install-cta';
import { MetaItem } from '~/components/layout/page-header';
import { ScoreBadge } from '~/components/revo/score-badge';
import { Meter } from '~/components/revo/stat-card';
import { ErrorState } from '~/components/shared/error-state';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import { Switch } from '~/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table';
import { useRepos, useUpdateRepoSettings } from '~/hooks/repos';
import { formatInt, formatRelative, formatUsd } from '~/lib/format';
import { cn } from '~/lib/utils';
import type { RepoRowDto } from '~/types/repo';

function EnabledSwitch({ repo }: { repo: RepoRowDto }) {
  const update = useUpdateRepoSettings(repo.id);
  return (
    <Switch
      checked={repo.enabled}
      onCheckedChange={(enabled) =>
        update.mutate(
          { enabled },
          {
            onSuccess: () =>
              toast.success(enabled ? 'Reviews on' : 'Reviews paused', {
                description: enabled
                  ? `Revo reviews new pull requests on ${repo.fullName}.`
                  : `Revo stops reviewing ${repo.fullName} until you turn it back on.`,
              }),
          },
        )
      }
      aria-label={`Reviews for ${repo.fullName}`}
    />
  );
}

function RepoName({ repo }: { repo: RepoRowDto }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="display grid size-10 shrink-0 place-items-center rounded-2xl bg-paper-sunken text-xl ring-1 ring-border"
      >
        {repo.name.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate font-medium">
          {repo.name}
          {repo.private ? (
            <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Private" />
          ) : null}
        </p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {repo.owner} · {modelName(repo.model).replace('Claude ', '')}
        </p>
      </div>
    </div>
  );
}

function Spend({ repo }: { repo: RepoRowDto }) {
  const b = repo.budget;
  return (
    <div className="min-w-28 space-y-1.5">
      <p className="tabular font-mono text-xs">
        <span className={cn(b.reached ? 'text-bad-ink' : 'text-foreground')}>{formatUsd(b.spentUsd)}</span>
        <span className="text-muted-foreground"> / {formatUsd(b.budgetUsd)}</span>
      </p>
      <Meter
        value={b.spentUsd}
        max={b.budgetUsd}
        kind="budget"
        label={`${repo.fullName} spend against budget`}
      />
    </div>
  );
}

const waiting = (
  <span className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
    <span className="relative flex size-1.5" aria-hidden="true">
      <span className="absolute inset-0 animate-ping rounded-full bg-accent-brand opacity-50" />
      <span className="relative size-1.5 rounded-full bg-accent-brand" />
    </span>
    Waiting for the first PR
  </span>
);

export function ReposView({ installUrl }: { installUrl: string | null }) {
  const { data, isPending, isError, error, refetch } = useRepos();
  if (isPending) return <ReposSkeleton />;
  if (isError) return <ErrorState message={error.message} onRetry={() => void refetch()} />;
  if (data.items.length === 0) return <InstallCta installUrl={installUrl} />;

  const now = new Date();
  const reached = data.items.filter((r) => r.enabled && r.budget.reached).map((r) => r.budget);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {data.installations.map((i) => (
            <MetaItem key={i.id} label={i.accountType === 'Organization' ? 'Organisation' : 'Account'}>
              {i.accountLogin}
              {i.suspended ? ' · suspended' : ''}
            </MetaItem>
          ))}
          <MetaItem label="Repos">{data.items.length}</MetaItem>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost" size="sm">
            <a href="#ai-access">
              <Key className="size-4" />
              AI access
            </a>
          </Button>
          {installUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={installUrl}>
                <Add className="size-4" />
                Add repos on GitHub
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <BudgetBanner budgets={reached} />

      {/* Phones: one card per repo. */}
      <ul className="grid gap-3 md:hidden">
        {data.items.map((repo) => (
          <li key={repo.id} className="rounded-3xl border border-border bg-card p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <RepoName repo={repo} />
              <EnabledSwitch repo={repo} />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
              {repo.lastReviewAt === null ? (
                <div className="col-span-3">{waiting}</div>
              ) : (
                <>
                  <div>
                    <p className="eyebrow text-[0.625rem]">Score · 30d</p>
                    <ScoreBadge score={repo.avgScore} className="mt-2" />
                  </div>
                  <div>
                    <p className="eyebrow text-[0.625rem]">PRs</p>
                    <p className="display tabular mt-2 text-[1.6rem] leading-none">
                      {formatInt(repo.prsReviewed)}
                    </p>
                  </div>
                  <div>
                    <p className="eyebrow text-[0.625rem]">Last</p>
                    <p className="mt-2 font-mono text-xs">{formatRelative(repo.lastReviewAt, now)}</p>
                  </div>
                </>
              )}
            </div>
            <div className="mt-4 flex items-end justify-between gap-4">
              <Spend repo={repo} />
              <Button asChild variant="outline" size="sm">
                <Link href={`/repos/${repo.id}/settings`}>
                  <Setting2 className="size-4" />
                  Settings
                </Link>
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-hidden rounded-3xl border border-border bg-card shadow-card md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="eyebrow h-11 pl-5">Repo</TableHead>
              <TableHead className="eyebrow">Reviews</TableHead>
              <TableHead className="eyebrow text-right">PRs reviewed</TableHead>
              <TableHead className="eyebrow">Avg score · 30d</TableHead>
              <TableHead className="eyebrow">Last review</TableHead>
              <TableHead className="eyebrow">Cost · month</TableHead>
              <TableHead className="w-14 pr-5">
                <span className="sr-only">Settings</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((repo) => (
              <TableRow key={repo.id} className={cn(!repo.enabled && 'text-muted-foreground')}>
                <TableCell className="py-4 pl-5">
                  <RepoName repo={repo} />
                </TableCell>
                <TableCell>
                  <EnabledSwitch repo={repo} />
                </TableCell>
                {repo.lastReviewAt === null ? (
                  <TableCell colSpan={3}>{waiting}</TableCell>
                ) : (
                  <>
                    <TableCell className="display tabular text-right text-[1.6rem]">
                      {formatInt(repo.prsReviewed)}
                    </TableCell>
                    <TableCell>
                      <ScoreBadge score={repo.avgScore} />
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap text-muted-foreground">
                      {formatRelative(repo.lastReviewAt, now)}
                    </TableCell>
                  </>
                )}
                <TableCell>
                  <Spend repo={repo} />
                </TableCell>
                <TableCell className="pr-5 text-right">
                  <Button asChild variant="ghost" size="icon" aria-label={`Settings for ${repo.fullName}`}>
                    <Link href={`/repos/${repo.id}/settings`}>
                      <Setting2 className="size-[18px]" />
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ReposSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading repos">
      <Skeleton className="h-4 w-64" />
      <Skeleton className="h-72 rounded-3xl" />
    </div>
  );
}
