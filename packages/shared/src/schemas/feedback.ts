import { z } from 'zod';
import { FEEDBACK_OUTCOMES } from '../constants';

export const FeedbackOutcomeSchema = z.enum(FEEDBACK_OUTCOMES);

/** Body of `PUT /api/findings/[id]/feedback`. */
export const FeedbackBodySchema = z.object({
  outcome: FeedbackOutcomeSchema,
  note: z.string().trim().max(500).optional(),
});
export type FeedbackBody = z.infer<typeof FeedbackBodySchema>;
