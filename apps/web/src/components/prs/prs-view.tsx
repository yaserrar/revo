'use client';

import { ArrowLeft2, ArrowRight2, CloseCircle, Danger, SearchNormal1, TaskSquare } from 'iconsax-react';
import { useEffect, useState } from 'react';
import { PR_STATE_LABELS, PR_STATES } from '@revo/shared';
import { MetaItem } from '~/components/layout/page-header';
import { InstallCta } from '~/components/dashboard/install-cta';
import { EmptyState } from '~/components/shared/empty-state';
import { ErrorState } from '~/components/shared/error-state';
import { Button } from '~/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '~/components/ui/input-group';
import { Skeleton } from '~/components/ui/skeleton';
import { Toggle } from '~/components/ui/toggle';
import { usePullRequestFilters, usePullRequests } from '~/hooks/prs';
import { formatInt } from '~/lib/format';
import { FacetFilter } from './facet-filter';
import { PrTable } from './pr-table';
import { ScoreFilter } from './score-filter';
import { activeFilterCount, PAGE_SIZE, toListQuery, usePrQueryState } from './use-pr-query';

const STATE_DOT = { open: 'bg-good', merged: 'bg-accent-brand', closed: 'bg-muted-foreground' } as const;

export function PrsView({ installUrl }: { installUrl: string | null }) {
  const [state, setState] = usePrQueryState();
  const query = toListQuery(state);
  const list = usePullRequests(query);
  const filters = usePullRequestFilters();
  const [search, setSearch] = useState(state.q);
  const [urlQ, setUrlQ] = useState(state.q);

  // The URL wins when it changes from outside (back/forward, reset); typing is debounced into it.
  if (urlQ !== state.q) {
    setUrlQ(state.q);
    setSearch(state.q);
  }
  useEffect(() => {
    if (search === state.q) return;
    const t = setTimeout(() => void setState({ q: search || null, page: null }), 250);
    return () => clearTimeout(t);
  }, [search, state.q, setState]);

  const filterCount = activeFilterCount(state);
  const reset = () =>
    void setState({
      q: null,
      repo: null,
      author: null,
      state: null,
      min: null,
      max: null,
      blockers: null,
      page: null,
    });
  const data = list.data;

  // No repo yet: the install step instead of filters over nothing.
  if (filters.data && filters.data.repos.length === 0) return <InstallCta installUrl={installUrl} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <InputGroup className="h-10 rounded-full bg-card lg:max-w-xs">
          <InputGroupAddon>
            <SearchNormal1 className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search titles or #number"
            aria-label="Search pull requests"
          />
        </InputGroup>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
          <FacetFilter
            title="Repo"
            options={(filters.data?.repos ?? []).map((r) => ({
              value: r.id,
              label: r.fullName.split('/')[1] ?? r.fullName,
            }))}
            selected={state.repo}
            onChange={(repo) => void setState({ repo: repo.length ? repo : null, page: null })}
          />
          <FacetFilter
            title="Author"
            searchable
            options={(filters.data?.authors ?? []).map((a) => ({ value: a, label: a }))}
            selected={state.author}
            onChange={(author) => void setState({ author: author.length ? author : null, page: null })}
          />
          <FacetFilter
            title="State"
            options={PR_STATES.map((s) => ({
              value: s,
              label: PR_STATE_LABELS[s],
              icon: <span className={`size-1.5 rounded-full ${STATE_DOT[s]}`} aria-hidden="true" />,
            }))}
            selected={state.state}
            onChange={(s) =>
              void setState({ state: s.length ? (s as typeof state.state) : null, page: null })
            }
          />
          <ScoreFilter
            value={{ min: state.min, max: state.max }}
            onChange={({ min, max }) => void setState({ min, max, page: null })}
          />
          <Toggle
            variant="outline"
            size="sm"
            pressed={state.blockers === 'yes'}
            onPressedChange={(on) => void setState({ blockers: on ? 'yes' : null, page: null })}
            className="h-9 gap-1.5 rounded-full border-dashed px-3 data-[state=on]:border-solid data-[state=on]:border-sev-blocker/40 data-[state=on]:bg-sev-blocker-soft data-[state=on]:text-sev-blocker-ink"
          >
            <Danger className="size-4" />
            Has blockers
          </Toggle>
          {filterCount > 0 || state.q ? (
            <Button variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={reset}>
              <CloseCircle className="size-4" />
              Reset
            </Button>
          ) : null}
        </div>
      </div>

      {list.isPending ? (
        <TableSkeleton />
      ) : list.isError ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : data && data.items.length === 0 ? (
        filterCount > 0 || state.q ? (
          <EmptyState
            icon={SearchNormal1}
            title="No pull request matches"
            description="Try fewer filters or another search."
            action={
              <Button variant="outline" onClick={reset}>
                Reset filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={TaskSquare}
            title="Waiting for the first PR"
            description="Pull requests appear here once Revo reviews them on an installed repo."
          />
        )
      ) : data ? (
        <>
          <PrTable
            rows={data.items}
            sort={state.sort}
            dir={state.dir}
            onSort={(sort, dir) => void setState({ sort, dir, page: null })}
            busy={list.isPlaceholderData}
          />
          <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <MetaItem label="Showing">
                {formatInt((data.page - 1) * PAGE_SIZE + 1)}–
                {formatInt((data.page - 1) * PAGE_SIZE + data.items.length)} of {formatInt(data.total)}
              </MetaItem>
              <MetaItem label="Page">
                {data.page} / {data.pageCount}
              </MetaItem>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={data.page <= 1}
                onClick={() => void setState({ page: data.page - 1 <= 1 ? null : data.page - 1 })}
              >
                <ArrowLeft2 className="size-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={data.page >= data.pageCount}
                onClick={() => void setState({ page: data.page + 1 })}
              >
                Next
                <ArrowRight2 className="size-4" />
              </Button>
            </div>
          </nav>
        </>
      ) : null}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div
      className="space-y-px overflow-hidden rounded-3xl border border-border bg-card"
      aria-busy="true"
      aria-label="Loading pull requests"
    >
      <Skeleton className="h-11 rounded-none" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-5 px-5 py-4">
          <Skeleton className="size-6 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="hidden h-4 w-20 sm:block" />
        </div>
      ))}
    </div>
  );
}
