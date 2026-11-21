import { canEditRepoSettings, IdParamsSchema } from '@revo/shared';
import { RepoSettingsBodySchema } from '~/schemas/repo-settings';
import { forbidden } from '~/server/http/errors';
import { route } from '~/server/http/route';
import { reposService } from '~/server/modules/repos/repos.service';

export const GET = route({ params: IdParamsSchema }, async ({ access, params }) => {
  const permission = await access.permission(params.id);
  return reposService.settings(params.id, canEditRepoSettings(permission));
});

export const PATCH = route(
  { params: IdParamsSchema, body: RepoSettingsBodySchema, rateLimit: 'mutation' },
  async ({ access, params, body }) => {
    // The budget, the model and the prompt instructions are the repo owners' call (spec 14).
    if (!canEditRepoSettings(await access.permission(params.id)))
      throw forbidden('Changing these settings needs the Maintain or Admin role on GitHub.');
    return reposService.updateSettings(params.id, body);
  },
);
