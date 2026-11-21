import type { RepoSettingsDto } from '@revo/shared';
import type { RepoSettingsBody } from '~/schemas/repo-settings';
import type { ReposDto, RepoSettingsPageDto } from '~/types/repo';
import { api } from './client';

export const reposApi = {
  list: () => api.get<ReposDto>('/repos'),
  settings: (id: string) => api.get<RepoSettingsPageDto>(`/repos/${id}/settings`),
  updateSettings: (id: string, body: RepoSettingsBody) =>
    api.patch<RepoSettingsDto>(`/repos/${id}/settings`, body),
};
