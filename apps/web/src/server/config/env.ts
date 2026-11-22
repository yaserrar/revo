import 'server-only';
import { z } from 'zod';
import {
  DEFAULT_FREE_MONTHLY_CAP_USD,
  DEFAULT_FREE_REVIEWS_PER_MONTH,
  DEFAULT_REVIEW_DEBOUNCE_SECONDS,
  parseOwnerAccounts,
} from '@revo/shared';

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const flag = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true');

/** A number, or the default when unset or blank (compose passes '' for unset values). */
const numberOr = (fallback: number) =>
  optional.transform((v) => (v === undefined ? fallback : Number(v))).pipe(z.number().min(0));

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
    /** Same rule as GITHUB_*_URL: a stand-in Claude API (the mock GitHub's /anthropic) for checking keys in tests. */
    ANTHROPIC_BASE_URL: optional,
    REVIEW_DEBOUNCE_SECONDS: z.coerce.number().int().min(0).default(DEFAULT_REVIEW_DEBOUNCE_SECONDS),
    /** Serve /dev/kit in a production build (screenshots of the design system). */
    REVO_ENABLE_DEV_KIT: flag,
    /** Production build under test: honour GITHUB_*_URL overrides that point at localhost. */
    REVO_TEST_MODE: flag,
    /** Free tier (same names and defaults as the worker): reviews per account per UTC month. */
    FREE_REVIEWS_PER_MONTH: numberOr(DEFAULT_FREE_REVIEWS_PER_MONTH).pipe(z.number().int()),
    /** Free tier: Revo's total free-tier spend per UTC month across every account, in USD. */
    FREE_MONTHLY_CAP_USD: numberOr(DEFAULT_FREE_MONTHLY_CAP_USD),
    /** Comma-separated GitHub logins that use Revo's key with no free-tier limits (lowercased list). */
    REVO_OWNER_ACCOUNTS: optional.transform(parseOwnerAccounts),
    /** Self-hosted, single owner: offer the Claude subscription logged in on this machine. */
    REVO_ALLOW_CLAUDE_SUBSCRIPTION: flag,
    /** Contact address on the legal pages (GitHub issues of the source repo otherwise). */
    CONTACT_EMAIL: optional,
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
 * GitHub and Anthropic endpoint overrides (the mock GitHub, which also stands
 * in for the Claude API under /anthropic) are honoured outside production, and
 * in a production build only with REVO_TEST_MODE=1 and a localhost URL (one
 * path segment at most).
 */
function githubOverride(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!isProduction) return value.replace(/\/$/, '');
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[\w-]+)?\/?$/.test(value);
  return parsed.REVO_TEST_MODE && local ? value.replace(/\/$/, '') : undefined;
}

export const env = {
  ...parsed,
  GITHUB_OAUTH_BASE_URL: githubOverride(parsed.GITHUB_OAUTH_BASE_URL) ?? 'https://github.com',
  GITHUB_API_URL: githubOverride(parsed.GITHUB_API_URL) ?? 'https://api.github.com',
  /** Where saved Anthropic API keys are checked (models.list). */
  ANTHROPIC_BASE_URL: githubOverride(parsed.ANTHROPIC_BASE_URL) ?? 'https://api.anthropic.com',
};

export const githubSignInEnabled = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
export const devKitEnabled = !isProduction || env.REVO_ENABLE_DEV_KIT;
