import type { TrendsQuery } from '~/schemas/trends';
import type { TrendsDto } from '~/types/trends';
import { api } from './client';

export const trendsApi = {
  get: (q: TrendsQuery) => api.get<TrendsDto>('/trends', q),
};
