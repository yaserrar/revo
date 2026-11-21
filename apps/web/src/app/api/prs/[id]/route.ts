import { IdParamsSchema } from '@revo/shared';
import { route } from '~/server/http/route';
import { pullRequestsService } from '~/server/modules/pull-requests/pull-requests.service';

export const GET = route({ params: IdParamsSchema }, async ({ access, params, user }) =>
  pullRequestsService.detail(params.id, await access.repoIds(), user.id),
);
