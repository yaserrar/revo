'use client';

import { parseAsArrayOf, parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { PR_STATES, type PullRequestListQueryInput } from '@revo/shared';

export const PR_SORTS = ['lastReviewed', 'score', 'number'] as const;
export const SORT_DIRS = ['asc', 'desc'] as const;
export const PAGE_SIZE = 20;

/** Filters, search, sort and page of the PR list, all in the URL (shareable). */
export const prQueryParsers = {
  q: parseAsString.withDefault(''),
  repo: parseAsArrayOf(parseAsString).withDefault([]),
  author: parseAsArrayOf(parseAsString).withDefault([]),
  state: parseAsArrayOf(parseAsStringLiteral(PR_STATES)).withDefault([]),
  min: parseAsInteger,
  max: parseAsInteger,
  blockers: parseAsStringLiteral(['yes', 'no'] as const),
  sort: parseAsStringLiteral(PR_SORTS).withDefault('lastReviewed'),
  dir: parseAsStringLiteral(SORT_DIRS).withDefault('desc'),
  page: parseAsInteger.withDefault(1),
};

export function usePrQueryState() {
  return useQueryStates(prQueryParsers, { history: 'replace' });
}

export type PrQueryState = ReturnType<typeof usePrQueryState>[0];

/** URL state → API query. */
export function toListQuery(s: PrQueryState): PullRequestListQueryInput {
  return {
    q: s.q || undefined,
    repo: s.repo.length ? s.repo : undefined,
    author: s.author.length ? s.author : undefined,
    state: s.state.length ? s.state : undefined,
    scoreMin: s.min ?? undefined,
    scoreMax: s.max ?? undefined,
    hasBlockers: s.blockers === null ? undefined : s.blockers === 'yes',
    sort: s.sort,
    dir: s.dir,
    page: s.page,
    pageSize: PAGE_SIZE,
  };
}

/** Number of active filters (search excluded). */
export function activeFilterCount(s: PrQueryState): number {
  return (
    (s.repo.length ? 1 : 0) +
    (s.author.length ? 1 : 0) +
    (s.state.length ? 1 : 0) +
    (s.min !== null || s.max !== null ? 1 : 0) +
    (s.blockers !== null ? 1 : 0)
  );
}
