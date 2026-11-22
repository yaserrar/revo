import { IdParamsSchema } from '@revo/shared';
import { AnthropicKeyBodySchema } from '~/schemas/ai-access';
import { route } from '~/server/http/route';
import { accountsService } from '~/server/modules/accounts/accounts.service';

/** Checks the key with Anthropic, then saves it encrypted (Admin on one of the account's repos). */
export const PUT = route(
  { params: IdParamsSchema, body: AnthropicKeyBodySchema, rateLimit: 'anthropicKey' },
  async ({ user, access, params, body }) =>
    accountsService.saveKey(user.id, params.id, await access.repoIds(), body.apiKey),
);

/** Deletes the saved key; the account goes back to the free tier. */
export const DELETE = route(
  { params: IdParamsSchema, rateLimit: 'mutation' },
  async ({ user, access, params }) => accountsService.removeKey(user.id, params.id, await access.repoIds()),
);
