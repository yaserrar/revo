import type { UserDto } from '@revo/shared';
import { api } from './client';

export const meApi = {
  get: () => api.get<UserDto>('/me'),
};
