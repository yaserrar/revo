import type { Paginated, PullRequestListQueryInput, PullRequestSummaryDto } from '@revo/shared';
import type { PullRequestDetailDto, PullRequestFiltersDto, ReviewAgainResultDto } from '~/types/pull-request';
import { api } from './client';

export const prsApi = {
  list: (q: PullRequestListQueryInput) =>
    api.get<Paginated<PullRequestSummaryDto>>(
      '/prs',
      q as Record<string, string | number | boolean | string[]>,
    ),
  filters: () => api.get<PullRequestFiltersDto>('/prs/filters'),
  detail: (id: string) => api.get<PullRequestDetailDto>(`/prs/${id}`),
  reviewAgain: (id: string) => api.post<ReviewAgainResultDto>(`/prs/${id}/review-again`),
};
