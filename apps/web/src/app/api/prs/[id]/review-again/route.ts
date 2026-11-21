import { IdParamsSchema } from '@revo/shared';
import { route } from '~/server/http/route';
import { pullRequestsService } from '~/server/modules/pull-requests/pull-requests.service';

/** Spec 11.4 "Review again"; rate limited per user (spec 14). */
export const POST = route(
  { params: IdParamsSchema, rateLimit: 'reviewAgain', status: 202 },
  async ({ access, params, user }) =>
    pullRequestsService.reviewAgain(params.id, await access.repoIds(), user.id),
);
