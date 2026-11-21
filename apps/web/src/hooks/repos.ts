import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '~/lib/query-keys';
import type { RepoSettingsBody } from '~/schemas/repo-settings';
import { reposApi } from '~/services/api/repos';
import type { ReposDto, RepoSettingsPageDto } from '~/types/repo';

export const useRepos = () => useQuery({ queryKey: qk.repos.list(), queryFn: reposApi.list });

export const useRepoSettings = (id: string) =>
  useQuery({ queryKey: qk.repos.settings(id), queryFn: () => reposApi.settings(id) });

/** Saves settings; the Repos table's switch updates optimistically. */
export const useUpdateRepoSettings = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RepoSettingsBody) => reposApi.updateSettings(id, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: qk.repos.list() });
      const previous = qc.getQueryData<ReposDto>(qk.repos.list());
      if (previous && body.enabled !== undefined) {
        qc.setQueryData<ReposDto>(qk.repos.list(), {
          ...previous,
          items: previous.items.map((r) => (r.id === id ? { ...r, enabled: body.enabled! } : r)),
        });
      }
      return { previous };
    },
    onError: (_err, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.repos.list(), ctx.previous);
    },
    onSuccess: (settings) => {
      qc.setQueryData<RepoSettingsPageDto>(qk.repos.settings(id), (page) =>
        page ? { ...page, settings } : page,
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.repos.all() });
      void qc.invalidateQueries({ queryKey: qk.overview() });
      void qc.invalidateQueries({ queryKey: qk.prs.all() });
    },
  });
};
