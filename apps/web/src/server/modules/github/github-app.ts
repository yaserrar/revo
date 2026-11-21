import 'server-only';
import { createGithubApp, createWebhookVerifier, GithubAppConfigSchema, type GithubApp } from '@revo/github';
import { env } from '~/server/config/env';

const globalForGithub = globalThis as unknown as {
  revoGithubApp?: GithubApp;
  revoWebhookVerifier?: ReturnType<typeof createWebhookVerifier>;
};

/**
 * The GitHub App client (installation tokens) used to create check runs from
 * the webhook. GITHUB_API_URL points it at the mock outside production.
 * Null when the app is not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY).
 */
export function githubApp(): GithubApp | null {
  if (globalForGithub.revoGithubApp) return globalForGithub.revoGithubApp;
  const parsed = GithubAppConfigSchema.omit({ webhookSecret: true }).safeParse({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    apiUrl: env.GITHUB_API_URL,
  });
  if (!parsed.success) return null;
  globalForGithub.revoGithubApp = createGithubApp(parsed.data);
  return globalForGithub.revoGithubApp;
}

/** Signature check for /api/github/webhook. Null when GITHUB_WEBHOOK_SECRET is not set. */
export function webhookVerifier(): ReturnType<typeof createWebhookVerifier> | null {
  if (!env.GITHUB_WEBHOOK_SECRET) return null;
  globalForGithub.revoWebhookVerifier ??= createWebhookVerifier(env.GITHUB_WEBHOOK_SECRET);
  return globalForGithub.revoWebhookVerifier;
}

/** Dashboard page of a PR, linked from checks and comments. */
export function dashboardPrUrl(pullRequestId: string): string {
  return `${env.APP_URL.replace(/\/$/, '')}/prs/${pullRequestId}`;
}
