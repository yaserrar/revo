import { z } from 'zod';
import { PR_STATES } from '../constants';

const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(item));

const boolParam = z.preprocess(
  (v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v),
  z.boolean(),
);

/** Query of `GET /api/prs` (spec 11.3). Values arrive as URL strings and are coerced. */
export const PullRequestListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  repo: csv(z.string().min(1)).optional(),
  author: csv(z.string().min(1)).optional(),
  state: csv(z.enum(PR_STATES)).optional(),
  scoreMin: z.coerce.number().int().min(0).max(100).optional(),
  scoreMax: z.coerce.number().int().min(0).max(100).optional(),
  hasBlockers: boolParam.optional(),
  sort: z.enum(['lastReviewed', 'score', 'number']).default('lastReviewed'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PullRequestListQuery = z.infer<typeof PullRequestListQuerySchema>;
export type PullRequestListQueryInput = z.input<typeof PullRequestListQuerySchema>;
