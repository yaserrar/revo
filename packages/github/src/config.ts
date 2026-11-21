import { z } from 'zod';

/**
 * GitHub App settings read from the environment. GITHUB_API_URL points the
 * Octokit clients at a mock GitHub in tests (never set in production).
 */
export const GithubAppConfigSchema = z.object({
  appId: z.coerce.number().int().positive(),
  /** PEM private key. Accepts real newlines or "\n" escapes (single-line env files). */
  privateKey: z
    .string()
    .min(1)
    .transform((key) => key.replace(/\\n/g, '\n').trim()),
  webhookSecret: z.string().min(1),
  apiUrl: z.url().default('https://api.github.com'),
});
export type GithubAppConfig = z.infer<typeof GithubAppConfigSchema>;

/** Reads GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_WEBHOOK_SECRET and GITHUB_API_URL. */
export function githubAppConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GithubAppConfig {
  return GithubAppConfigSchema.parse({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    apiUrl: env.GITHUB_API_URL || undefined,
  });
}
