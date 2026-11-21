'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown2, ArrowUp2 } from 'iconsax-react';
import Link from 'next/link';
import { useMemo } from 'react';
import type { PullRequestSummaryDto } from '@revo/shared';
import { PrStateChip, ReviewStatusChip, SeverityTally } from '~/components/revo/chips';
import { ScoreBadge } from '~/components/revo/score-badge';
import { UserAvatar } from '~/components/shared/user-avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table';
import { formatRelative } from '~/lib/format';
import { cn } from '~/lib/utils';
import type { PR_SORTS } from './use-pr-query';

type Sort = (typeof PR_SORTS)[number];

type Meta = { headClass?: string; cellClass?: string; sortKey?: Sort };

function columns(now: Date): ColumnDef<PullRequestSummaryDto>[] {
  return [
    {
      id: 'score',
      header: 'Score',
      meta: {
        headClass: 'w-20 pl-4 sm:w-24 sm:pl-5',
        cellClass: 'pl-4 sm:pl-5',
        sortKey: 'score',
      } satisfies Meta,
      cell: ({ row }) => {
        const r = row.original.latestReview;
        return <ScoreBadge score={r?.status === 'done' ? r.score : null} />;
      },
    },
    {
      id: 'title',
      header: 'Pull request',
      meta: { cellClass: 'max-w-0 min-w-56 whitespace-normal', sortKey: 'number' } satisfies Meta,
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="min-w-0">
            <Link
              href={`/prs/${p.id}`}
              className="block truncate font-medium outline-none after:absolute after:inset-0 after:content-[''] hover:underline hover:decoration-border hover:underline-offset-4 focus-visible:after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
            >
              {p.title}
            </Link>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <span className="truncate">
                <span className="lg:hidden">{p.repo.fullName.split('/')[1]} · </span>#{p.number}
                <span className="hidden sm:inline md:hidden"> · {p.author}</span>
                {p.lastReviewedAt ? (
                  <span className="sm:hidden"> · {formatRelative(p.lastReviewedAt, now)}</span>
                ) : null}
              </span>
            </p>
            {/* Phones: the Findings and State columns are hidden, so their facts move here. */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:hidden">
              <PrStateChip state={p.state} draft={p.draft} />
              <FindingsSummary row={p} />
            </div>
          </div>
        );
      },
    },
    {
      id: 'repo',
      header: 'Repo',
      meta: { headClass: 'hidden lg:table-cell', cellClass: 'hidden lg:table-cell' } satisfies Meta,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-ink-soft">{row.original.repo.fullName.split('/')[1]}</span>
      ),
    },
    {
      id: 'author',
      header: 'Author',
      meta: { headClass: 'hidden md:table-cell', cellClass: 'hidden md:table-cell' } satisfies Meta,
      cell: ({ row }) => (
        <span className="flex items-center gap-2 font-mono text-xs text-ink-soft">
          <UserAvatar
            login={row.original.author}
            src={row.original.authorAvatarUrl}
            size="sm"
            className="size-5"
          />
          <span className="max-w-32 truncate">{row.original.author}</span>
        </span>
      ),
    },
    {
      id: 'findings',
      header: 'Findings',
      meta: { headClass: 'hidden sm:table-cell', cellClass: 'hidden sm:table-cell' } satisfies Meta,
      cell: ({ row }) => <FindingsSummary row={row.original} />,
    },
    {
      id: 'state',
      header: 'State',
      meta: { headClass: 'hidden md:table-cell', cellClass: 'hidden md:table-cell' } satisfies Meta,
      cell: ({ row }) => <PrStateChip state={row.original.state} draft={row.original.draft} />,
    },
    {
      id: 'lastReviewed',
      header: 'Reviewed',
      meta: {
        headClass: 'hidden pr-5 text-right sm:table-cell',
        cellClass:
          'hidden pr-5 text-right font-mono text-xs whitespace-nowrap text-muted-foreground sm:table-cell',
        sortKey: 'lastReviewed',
      } satisfies Meta,
      cell: ({ row }) =>
        row.original.lastReviewedAt ? (
          <time dateTime={row.original.lastReviewedAt}>
            {formatRelative(row.original.lastReviewedAt, now)}
          </time>
        ) : (
          '—'
        ),
    },
  ];
}

/** The latest review's findings, or why there is no score (skipped, queued, failed, not reviewed). */
function FindingsSummary({ row }: { row: PullRequestSummaryDto }) {
  const r = row.latestReview;
  if (!r) return <span className="font-mono text-xs text-muted-foreground">Not reviewed</span>;
  if (r.status !== 'done') return <ReviewStatusChip status={r.status} skipReason={r.skipReason} />;
  return <SeverityTally counts={row.severityCounts} />;
}

/** Server-sorted, server-paginated PR table (TanStack Table in manual mode). */
export function PrTable({
  rows,
  sort,
  dir,
  onSort,
  busy,
}: {
  rows: PullRequestSummaryDto[];
  sort: Sort;
  dir: 'asc' | 'desc';
  onSort: (sort: Sort, dir: 'asc' | 'desc') => void;
  busy: boolean;
}) {
  const cols = useMemo(() => columns(new Date()), []);
  const sorting: SortingState = [{ id: sort, desc: dir === 'desc' }];
  // TanStack Table returns fresh functions each render, so the React Compiler skips this component (expected).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns: cols,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    state: { sorting },
    getRowId: (r) => r.id,
  });

  return (
    <div
      className={cn(
        'overflow-hidden rounded-3xl border border-border bg-card shadow-card transition-opacity',
        busy && 'opacity-70',
      )}
      aria-busy={busy}
    >
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta as Meta | undefined;
                const key = meta?.sortKey;
                const active = key === sort;
                return (
                  <TableHead
                    key={header.id}
                    className={cn('eyebrow h-11', meta?.headClass)}
                    aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {key ? (
                      <button
                        type="button"
                        onClick={() => onSort(key, active && dir === 'desc' ? 'asc' : 'desc')}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                          active && 'text-foreground',
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {active ? (
                          dir === 'asc' ? (
                            <ArrowUp2 className="size-3" />
                          ) : (
                            <ArrowDown2 className="size-3" />
                          )
                        ) : null}
                        <span className="sr-only">, sort</span>
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} className="relative">
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta as Meta | undefined;
                return (
                  <TableCell key={cell.id} className={cn('py-4', meta?.cellClass)}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
