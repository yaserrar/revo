import { route } from '~/server/http/route';
import { reposService } from '~/server/modules/repos/repos.service';

export const GET = route({}, async ({ access }) => reposService.list(await access.repoIds()));
