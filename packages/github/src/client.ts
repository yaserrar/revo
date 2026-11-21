import { App } from '@octokit/app';
import { Octokit as OctokitCore } from '@octokit/core';
import { paginateRest } from '@octokit/plugin-paginate-rest';
import { RequestError } from '@octokit/request-error';
import type { GithubAppConfig } from './config';

/** Octokit with pagination, pointed at api.github.com or the mock (GITHUB_API_URL). */
export const RevoOctokit = OctokitCore.plugin(paginateRest);
export type GithubClient = InstanceType<typeof RevoOctokit>;

/** Who the App is on GitHub: its comments are written by `botLogin` ("<slug>[bot]"). */
export type AppIdentity = { appId: number; slug: string; botLogin: string };

export type GithubApp = {
  /** An Octokit authenticated as one installation (token minted and cached by @octokit/auth-app). */
  installation(installationId: number): Promise<GithubClient>;
  /** The App's id, slug and bot login (GET /app, read once and cached). */
  identity(): Promise<AppIdentity>;
};

/** Repo coordinates for REST calls. */
export type RepoRef = { owner: string; repo: string };

export function repoRef(fullName: string): RepoRef {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) throw new Error(`Not a repo full name: "${fullName}"`);
  return { owner, repo };
}

/**
 * GitHub App client: signs app JWTs with the private key and exchanges them
 * for installation tokens. `apiUrl` is api.github.com, or the mock in tests.
 */
export function createGithubApp(config: Pick<GithubAppConfig, 'appId' | 'privateKey' | 'apiUrl'>): GithubApp {
  const Octokit = RevoOctokit.defaults({
    baseUrl: config.apiUrl.replace(/\/$/, ''),
    userAgent: 'Revo',
    request: { retries: 0 },
  });
  const app = new App({ appId: config.appId, privateKey: config.privateKey, Octokit });
  let identity: Promise<AppIdentity> | null = null;
  return {
    installation: (installationId) => app.getInstallationOctokit(installationId),
    identity: () => {
      identity ??= app.octokit
        .request('GET /app')
        .then(({ data }) => {
          if (!data) throw new Error('GitHub returned no App for these credentials');
          const slug = data.slug ?? String(data.id);
          return { appId: data.id, slug, botLogin: `${slug}[bot]` };
        })
        .catch((err: unknown) => {
          identity = null;
          throw err;
        });
      return identity;
    },
  };
}

/** True when a comment was written by the App itself (never trust a marker in someone else's). */
export function isAppComment(
  comment: { user?: { login: string; type?: string } | null },
  app: Pick<AppIdentity, 'botLogin'>,
): boolean {
  return comment.user?.type === 'Bot' && comment.user.login.toLowerCase() === app.botLogin.toLowerCase();
}

/** HTTP status of an Octokit error, or null for anything else (network errors, bugs). */
export function githubErrorStatus(err: unknown): number | null {
  return err instanceof RequestError ? err.status : null;
}

/**
 * A 403/429 that is GitHub's rate limit (primary: no requests left; secondary:
 * "secondary rate limit" or a retry-after), as opposed to a permission refusal.
 */
export function isGithubRateLimit(err: unknown): boolean {
  if (!(err instanceof RequestError)) return false;
  if (err.status === 429) return true;
  if (err.status !== 403) return false;
  const headers = err.response?.headers ?? {};
  if (headers['x-ratelimit-remaining'] === '0' || headers['retry-after'] !== undefined) return true;
  return /rate limit/i.test(err.message);
}
