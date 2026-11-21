import { z } from 'zod';
import { TREND_RANGES } from '~/types/trends';

export const TREND_RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;

/** Query of `GET /api/trends`. */
export const TrendsQuerySchema = z.object({
  range: z.enum(TREND_RANGES).default('30d'),
  repo: z.string().min(1).max(64).optional(),
});
export type TrendsQuery = z.infer<typeof TrendsQuerySchema>;
