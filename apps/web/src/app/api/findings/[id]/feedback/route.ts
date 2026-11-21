import { FeedbackBodySchema, IdParamsSchema } from '@revo/shared';
import { route } from '~/server/http/route';
import { feedbackService } from '~/server/modules/findings/feedback.service';

/** Sets or changes the signed-in user's feedback on a finding. */
export const PUT = route(
  { params: IdParamsSchema, body: FeedbackBodySchema, rateLimit: 'mutation' },
  async ({ access, params, user, body }) =>
    feedbackService.set(params.id, await access.repoIds(), user.id, body),
);

/** Removes it (undo). */
export const DELETE = route(
  { params: IdParamsSchema, rateLimit: 'mutation' },
  async ({ access, params, user }) => feedbackService.clear(params.id, await access.repoIds(), user.id),
);
