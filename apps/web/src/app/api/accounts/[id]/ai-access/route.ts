import { IdParamsSchema } from '@revo/shared';
import { AiAccessBodySchema } from '~/schemas/ai-access';
import { route } from '~/server/http/route';
import { accountsService } from '~/server/modules/accounts/accounts.service';

/** Free tier, the saved key, or the Claude subscription (Admin on one of the account's repos). */
export const PATCH = route(
  { params: IdParamsSchema, body: AiAccessBodySchema, rateLimit: 'mutation' },
  async ({ user, access, params, body }) =>
    accountsService.setAccess(user.id, params.id, await access.repoIds(), body.aiAccess),
);
