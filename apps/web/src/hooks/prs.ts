import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PullRequestListQueryInput } from '@revo/shared';
import { qk } from '~/lib/query-keys';
import { prsApi } from '~/services/api/prs';

export const usePullRequests = (q: PullRequestListQueryInput, enabled = true) =>
  useQuery({
    queryKey: qk.prs.list(q),
    queryFn: () => prsApi.list(q),
    placeholderData: keepPreviousData,
    enabled,
  });

export const usePullRequestFilters = () =>
  useQuery({ queryKey: qk.prs.filters(), queryFn: prsApi.filters, staleTime: 5 * 60_000 });

/** PR detail; polls while a review is queued or running. */
export const usePullRequest = (id: string) =>
  useQuery({
    queryKey: qk.prs.detail(id),
    queryFn: () => prsApi.detail(id),
    refetchInterval: (query) => {
      const status = query.state.data?.reviews[0]?.status;
      return status === 'queued' || status === 'running' ? 5_000 : false;
    },
  });

export const useReviewAgain = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => prsApi.reviewAgain(id),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.prs.detail(id) }),
  });
};
