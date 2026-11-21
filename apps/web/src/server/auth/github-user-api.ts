import 'server-only';
import { z } from 'zod';
import { repoPermissionFrom, type RepoPermission } from '@revo/shared';
import { env } from '../config/env';

/** Calls the GitHub REST API (or the mock in tests) with a user-to-server token. */
async function githubUserGet<T>(token: string, path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${env.GITHUB_API_URL}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'Revo',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
  });
  if (res.status === 401) throw new GithubTokenError('GitHub rejected the user token');
  if (!res.ok) throw new Error(`GitHub ${path} failed with ${res.status}`);
  return schema.parse(await res.json());
}

export class GithubTokenError extends Error {}

const installationsPage = z.object({
  total_count: z.number(),
  installations: z.array(z.object({ id: z.number() })),
});
const reposPage = z.object({
  total_count: z.number(),
  repositories: z.array(
    z.object({
      id: z.number(),
      full_name: z.string(),
      permissions: z
        .object({
          admin: z.boolean().optional(),
          maintain: z.boolean().optional(),
          push: z.boolean().optional(),
          triage: z.boolean().optional(),
          pull: z.boolean().optional(),
        })
        .optional(),
    }),
  ),
});

const PER_PAGE = 100;

/** Installation ids of the Revo app the user can access. */
export async function listUserInstallationIds(token: string): Promise<number[]> {
  const ids: number[] = [];
  for (let page = 1; ; page++) {
    const data = await githubUserGet(
      token,
      `/user/installations?per_page=${PER_PAGE}&page=${page}`,
      installationsPage,
    );
    ids.push(...data.installations.map((i) => i.id));
    if (data.installations.length < PER_PAGE || ids.length >= data.total_count) return ids;
  }
}

export type RepoGrant = { id: number; permission: RepoPermission };

/** Repos the user can access through one installation, with the user's role on each. */
export async function listInstallationRepos(token: string, installationId: number): Promise<RepoGrant[]> {
  const repos: RepoGrant[] = [];
  for (let page = 1; ; page++) {
    const data = await githubUserGet(
      token,
      `/user/installations/${installationId}/repositories?per_page=${PER_PAGE}&page=${page}`,
      reposPage,
    );
    repos.push(
      ...data.repositories.map((r) => ({ id: r.id, permission: repoPermissionFrom(r.permissions) })),
    );
    if (data.repositories.length < PER_PAGE || repos.length >= data.total_count) return repos;
  }
}

const tokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  refresh_token_expires_in: z.number().optional(),
});
export type GithubTokens = z.infer<typeof tokenResponse>;

/** Exchanges a refresh token for a new user token (GitHub App tokens expire after 8 hours). */
export async function refreshGithubUserToken(refreshToken: string): Promise<GithubTokens> {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) throw new Error('GitHub OAuth is not configured');
  const res = await fetch(`${env.GITHUB_OAUTH_BASE_URL}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    cache: 'no-store',
  });
  const json: unknown = await res.json();
  const parsed = tokenResponse.safeParse(json);
  if (!res.ok || !parsed.success) throw new GithubTokenError('GitHub refused to refresh the user token');
  return parsed.data;
}
