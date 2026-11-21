import type { PullRequestListQueryInput } from '@revo/shared';

/**
 * Every React Query key lives here. `all` keys are prefixes for invalidation.
 * Add keys for new resources in this file (additive changes only).
 */
export const qk = {
  me: () => ['me'] as const,
  overview: () => ['overview'] as const,
  prs: {
    all: () => ['prs'] as const,
    list: (q: PullRequestListQueryInput) => ['prs', 'list', q] as const,
    detail: (id: string) => ['prs', 'detail', id] as const,
    reviews: (id: string) => ['prs', 'detail', id, 'reviews'] as const,
    filters: () => ['prs', 'filters'] as const,
  },
  reviews: {
    detail: (id: string) => ['reviews', id] as const,
  },
  repos: {
    all: () => ['repos'] as const,
    list: () => ['repos', 'list'] as const,
    settings: (id: string) => ['repos', id, 'settings'] as const,
  },
  trends: (range: string, repo?: string) => ['trends', range, repo ?? 'all'] as const,
};
