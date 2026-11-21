import { TrendsQuerySchema } from '~/schemas/trends';
import { route } from '~/server/http/route';
import { trendsService } from '~/server/modules/trends/trends.service';

export const GET = route({ query: TrendsQuerySchema }, async ({ access, query }) =>
  trendsService.get(await access.repoIds(), query),
);
