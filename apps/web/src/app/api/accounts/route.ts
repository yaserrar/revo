import { route } from '~/server/http/route';
import { accountsService } from '~/server/modules/accounts/accounts.service';

export const GET = route({}, async ({ user, access }) =>
  accountsService.list(user.id, await access.repoIds()),
);
