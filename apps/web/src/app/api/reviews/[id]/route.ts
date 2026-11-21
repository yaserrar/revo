import { IdParamsSchema } from '@revo/shared';
import { route } from '~/server/http/route';
import { reviewsService } from '~/server/modules/reviews/reviews.service';

export const GET = route({ params: IdParamsSchema }, async ({ access, params, user }) =>
  reviewsService.detail(params.id, await access.repoIds(), user.id),
);
