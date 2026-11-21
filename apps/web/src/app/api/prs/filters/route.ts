import { route } from '~/server/http/route';
import { pullRequestsService } from '~/server/modules/pull-requests/pull-requests.service';

export const GET = route({}, async ({ access }) => pullRequestsService.filters(await access.repoIds()));
