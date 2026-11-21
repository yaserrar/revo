import { route } from '~/server/http/route';
import { overviewService } from '~/server/modules/overview/overview.service';

export const GET = route({}, async ({ access }) => overviewService.get(await access.repoIds()));
