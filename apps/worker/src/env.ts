import { z } from 'zod';
import { GithubAppConfigSchema } from '@revo/github';
import {
  DEFAULT_FREE_MONTHLY_CAP_USD,
  DEFAULT_FREE_REVIEWS_PER_MONTH,
  DEFAULT_REVIEW_DEBOUNCE_SECONDS,
  ENGINE_KINDS,
  parseOwnerAccounts,
  QUEUE_PREFIX,
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

export const WorkerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
    /** BullMQ key prefix; tests use their own. */
    REVO_QUEUE_PREFIX: optional.transform((v) => v ?? QUEUE_PREFIX),
    APP_URL: z.url().default('http://localhost:3830'),
    GITHUB_APP_ID: z.string().min(1, 'GITHUB_APP_ID is required'),
    GITHUB_APP_PRIVATE_KEY: z.string().min(1, 'GITHUB_APP_PRIVATE_KEY is required'),
    /** Mock GitHub for local runs and tests; see githubApiUrl(). */
    GITHUB_API_URL: optional,
    REVO_TEST_MODE: flag,
    /** `fake` = deterministic offline engine; `claude` needs ANTHROPIC_API_KEY. */
    REVO_ENGINE: optional.pipe(z.enum(ENGINE_KINDS).optional()),
    ANTHROPIC_API_KEY: optional,
    REVIEW_DEBOUNCE_SECONDS: z.coerce.number().int().min(0).default(DEFAULT_REVIEW_DEBOUNCE_SECONDS),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
    /**
     * Reads the accounts' Anthropic API keys saved by the web app: must be the
     * same TOKEN_ENCRYPTION_KEY as the web app (or the same AUTH_SECRET, which
     * the key is derived from when TOKEN_ENCRYPTION_KEY is not set).
     */
    TOKEN_ENCRYPTION_KEY: optional,
    AUTH_SECRET: optional,
    /** Free tier: reviews per account per UTC month on Revo's key. */
    FREE_REVIEWS_PER_MONTH: numberOr(DEFAULT_FREE_REVIEWS_PER_MONTH).pipe(z.number().int()),
    /** Free tier: Revo's total free-tier spend per UTC month across every account, in USD. */
    FREE_MONTHLY_CAP_USD: numberOr(DEFAULT_FREE_MONTHLY_CAP_USD),
    /** Comma-separated GitHub logins that use Revo's key with no free-tier limits (lowercased list). */
    REVO_OWNER_ACCOUNTS: optional.transform(parseOwnerAccounts),
    /** Self-hosted, single owner: accounts may use the Claude subscription logged in on this machine. */
    REVO_ALLOW_CLAUDE_SUBSCRIPTION: flag,
  })
  .transform((env) => ({
    ...env,
    REVO_ENGINE: env.REVO_ENGINE ?? (env.ANTHROPIC_API_KEY ? 'claude' : 'fake'),
  }))
  .superRefine((env, ctx) => {
    // The fake engine posts made-up findings and scores: never on real PRs,
    // in production or in a local run connected to the real GitHub.
    const realGithub = githubApiUrl(env) === 'https://api.github.com';
    if (env.REVO_ENGINE === 'fake' && realGithub && !env.REVO_TEST_MODE) {
      ctx.addIssue({
        code: 'custom',
        path: ['REVO_ENGINE'],
        message:
          'the fake engine is refused with the real GitHub (it would post made-up findings on real PRs): set ANTHROPIC_API_KEY, or point GITHUB_API_URL at the mock GitHub (REVO_TEST_MODE=1 only for tests)',
      });
    }
    if (env.REVO_ENGINE === 'claude' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'REVO_ENGINE=claude needs ANTHROPIC_API_KEY',
      });
    }
  });
export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

/** Parses the environment and lists every problem at once. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = WorkerEnvSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid worker environment:\n${lines}`);
  }
  return parsed.data;
}

/**
 * GitHub API base URL. GITHUB_API_URL (the mock) is honoured outside
 * production, and in production only with REVO_TEST_MODE=1 and a localhost
 * URL, like the web app.
 */
export function githubApiUrl(env: Pick<WorkerEnv, 'NODE_ENV' | 'GITHUB_API_URL' | 'REVO_TEST_MODE'>): string {
  const override = env.GITHUB_API_URL?.replace(/\/$/, '');
  if (override && env.NODE_ENV !== 'production') return override;
  if (override && env.REVO_TEST_MODE && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(override))
    return override;
  return 'https://api.github.com';
}

/** GitHub App credentials, validated (the key may use "\n" escapes). */
export function githubConfig(env: WorkerEnv) {
  return GithubAppConfigSchema.omit({ webhookSecret: true }).parse({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    apiUrl: githubApiUrl(env),
  });
}
