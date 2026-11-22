import { z } from 'zod';
import { AI_ACCESS } from '@revo/shared';

/**
 * Body of `PUT /api/accounts/[id]/anthropic-key`. Anthropic API keys start
 * with "sk-ant-"; the length bounds only keep junk out before the check call.
 */
export const AnthropicKeyBodySchema = z.object({
  apiKey: z
    .string()
    .trim()
    .min(20, 'This is too short to be an Anthropic API key.')
    .max(400, 'This is too long to be an Anthropic API key.')
    .regex(/^sk-ant-[\w-]+$/, 'Anthropic API keys start with “sk-ant-”.'),
});
export type AnthropicKeyBody = z.infer<typeof AnthropicKeyBodySchema>;

/** Body of `PATCH /api/accounts/[id]/ai-access`. */
export const AiAccessBodySchema = z.object({ aiAccess: z.enum(AI_ACCESS) });
export type AiAccessBody = z.infer<typeof AiAccessBodySchema>;
