import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  APP_URL: z.string().url(),
  PAYMENTS_API_URL: z.string().url(),
  PAYMENTS_API_KEY: z.string().min(1),
  PAYMENTS_WEBHOOK_SECRET: z.string().min(16),
  MAIL_FROM: z.string().email(),
});

/** Server configuration, validated once at startup. Secrets only come from the environment. */
export const env = EnvSchema.parse(process.env);
