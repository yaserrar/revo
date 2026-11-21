import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { qk } from '~/lib/query-keys';
import type { TrendsQuery } from '~/schemas/trends';
import { trendsApi } from '~/services/api/trends';

export const useTrends = (q: TrendsQuery) =>
  useQuery({
    queryKey: qk.trends(q.range, q.repo),
    queryFn: () => trendsApi.get(q),
    placeholderData: keepPreviousData,
  });
