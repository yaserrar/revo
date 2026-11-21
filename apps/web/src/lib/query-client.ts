import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '~/services/api/client';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { silent?: boolean };
  }
}

function onUnauthorized(error: unknown) {
  if (error instanceof ApiError && error.status === 401 && typeof window !== 'undefined') {
    // A full navigation drops every cached query of the expired session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(
      `/sign-in?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`,
    );
  }
}

/**
 * Shared defaults: short stale time, no retry on 4xx, 401 sends to sign-in,
 * failed mutations toast their message unless `meta: { silent: true }`.
 */
export function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({ onError: onUnauthorized }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        onUnauthorized(error);
        if (!mutation.meta?.silent)
          toast.error(error instanceof Error ? error.message : 'Something went wrong.');
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      },
    },
  });
}
