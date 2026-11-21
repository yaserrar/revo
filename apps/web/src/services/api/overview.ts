import type { OverviewDto } from '~/types/overview';
import { api } from './client';

export const overviewApi = {
  get: () => api.get<OverviewDto>('/overview'),
};
