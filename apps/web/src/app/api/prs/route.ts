import { PullRequestListQuerySchema } from '@revo/shared';
import { route } from '~/server/http/route';
import { pullRequestsService } from '~/server/modules/pull-requests/pull-requests.service';

export const GET = route({ query: PullRequestListQuerySchema }, async ({ access, query }) =>
  pullRequestsService.list(await access.repoIds(), query),
);
