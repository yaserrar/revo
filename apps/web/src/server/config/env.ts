import 'server-only';
import { z } from 'zod';
import { DEFAULT_REVIEW_DEBOUNCE_SECONDS } from '@revo/shared';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const flag = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Public URL of the dashboard (links in PR comments, OAuth callback base). */
    APP_URL: z.url().default('http://localhost:3830'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1).default('redis://localhost:6379/7'),
    /** Auth.js secret, 32+ characters (`openssl rand -base64 32`). */
    AUTH_SECRET: optional,
    /** Key for the GitHub tokens stored in the database. Defaults to a key derived from AUTH_SECRET. */
    TOKEN_ENCRYPTION_KEY: optional,
    GITHUB_CLIENT_ID: optional,
    GITHUB_CLIENT_SECRET: optional,
    /** Public slug of the GitHub App, for the "Install on GitHub" link. */
    GITHUB_APP_SLUG: optional,
    GITHUB_WEBHOOK_SECRET: optional,
    /** GitHub App id and PEM private key: the webhook route creates check runs as the app. */
    GITHUB_APP_ID: optional,
    GITHUB_APP_PRIVATE_KEY: optional,
    /** BullMQ key prefix (default "revo"); tests use their own so they never touch real jobs. */
    REVO_QUEUE_PREFIX: optional,
    /** Non-production only: a mock GitHub for tests (github.com / api.github.com otherwise). */
    GITHUB_OAUTH_BASE_URL: optional,
    GITHUB_API_URL: optional,
    REVIEW_DEBOUNCE_SECONDS: z.coerce.number().int().min(0).default(DEFAULT_REVIEW_DEBOUNCE_SECONDS),
    /** Serve /dev/kit in a production build (screenshots of the design system). */
    REVO_ENABLE_DEV_KIT: flag,
    /** Production build under test: honour GITHUB_*_URL overrides that point at localhost. */
    REVO_TEST_MODE: flag,
  })
  .superRefine((v, ctx) => {
    // Secrets are checked when the server starts, not during `next build` (images are built without them).
    const building = process.env.NEXT_PHASE === 'phase-production-build';
    if (v.NODE_ENV === 'production' && !building && (!v.AUTH_SECRET || v.AUTH_SECRET.length < 32)) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_SECRET'],
        message: 'Set an AUTH_SECRET of 32+ characters in production',
      });
    }
  });

const parsed = envSchema.parse(process.env);
const isProduction = parsed.NODE_ENV === 'production';

/**
 * GitHub endpoint overrides (a mock GitHub) are honoured outside production,
 * and in a production build only with REVO_TEST_MODE=1 and a localhost URL.
 */
function githubOverride(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!isProduction) return value.replace(/\/$/, '');
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(value);
  return parsed.REVO_TEST_MODE && local ? value.replace(/\/$/, '') : undefined;
}

export const env = {
  ...parsed,
  GITHUB_OAUTH_BASE_URL: githubOverride(parsed.GITHUB_OAUTH_BASE_URL) ?? 'https://github.com',
  GITHUB_API_URL: githubOverride(parsed.GITHUB_API_URL) ?? 'https://api.github.com',
};

export const githubSignInEnabled = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
export const devKitEnabled = !isProduction || env.REVO_ENABLE_DEV_KIT;
