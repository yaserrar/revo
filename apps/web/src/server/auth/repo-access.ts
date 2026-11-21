import 'server-only';
import { REPO_ACCESS_TTL_MS, type RepoPermission } from '@revo/shared';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';
import { HttpError, notFound } from '../http/errors';
import { decryptSecret } from '../security/crypto';
import {
  GithubTokenError,
  listInstallationRepos,
  listUserInstallationIds,
  refreshGithubUserToken,
} from './github-user-api';
import { tokenColumns } from './users';

/** A user-to-server token that is valid now, refreshing it when it expired. Null when none is usable. */
async function usableToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.accessTokenEnc) return null;
  const soon = Date.now() + 60_000;
  if (!user.accessTokenExpiresAt || user.accessTokenExpiresAt.getTime() > soon)
    return decryptSecret(user.accessTokenEnc);
  if (!user.refreshTokenEnc || (user.refreshTokenExpiresAt && user.refreshTokenExpiresAt.getTime() < soon))
    return null;
  const tokens = await refreshGithubUserToken(decryptSecret(user.refreshTokenEnc));
  await prisma.user.update({ where: { id: userId }, data: tokenColumns(tokens) });
  return tokens.access_token;
}

/**
 * Re-reads from GitHub which repos the user can access (through the
 * installations Revo knows), with the user's role on each, and replaces the
 * RepoAccess snapshot. Called at sign-in and when the snapshot is older than an hour.
 */
export async function refreshRepoAccess(userId: string): Promise<void> {
  const token = await usableToken(userId);
  if (!token) throw new GithubTokenError('No usable GitHub token: sign in again');

  const installationIds = await listUserInstallationIds(token);
  const known = await prisma.installation.findMany({
    where: { githubId: { in: installationIds.map(BigInt) } },
    select: { githubId: true },
  });
  const grants = new Map<bigint, RepoPermission>();
  for (const inst of known) {
    for (const repo of await listInstallationRepos(token, Number(inst.githubId)))
      grants.set(BigInt(repo.id), repo.permission);
  }
  const repos = await prisma.repo.findMany({
    where: { githubId: { in: [...grants.keys()] } },
    select: { id: true, githubId: true },
  });
  const now = new Date();
  await prisma.$transaction([
    prisma.repoAccess.deleteMany({ where: { userId } }),
    prisma.repoAccess.createMany({
      data: repos.map((r) => ({
        userId,
        repoId: r.id,
        checkedAt: now,
        permission: grants.get(r.githubId) ?? 'read',
      })),
    }),
    prisma.user.update({ where: { id: userId }, data: { accessCheckedAt: now } }),
  ]);
}

/**
 * GitHub no longer accepts the user's authorization (token revoked, refresh
 * refused or expired): forget what they could see and their tokens, so every
 * request asks them to sign in again instead of trusting an old snapshot.
 */
async function revokeAccess(userId: string): Promise<void> {
  await prisma.$transaction([
    prisma.repoAccess.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        accessTokenEnc: null,
        accessTokenExpiresAt: null,
        refreshTokenEnc: null,
        refreshTokenExpiresAt: null,
        accessCheckedAt: null,
      },
    }),
  ]);
}

type RefreshResult = 'refreshed' | 'signed-out' | 'unavailable';

/**
 * A page load fires several API calls at once; they share one refresh per
 * user instead of racing to replace the same snapshot.
 */
const refreshing = new Map<string, Promise<RefreshResult>>();

function refreshOnce(userId: string): Promise<RefreshResult> {
  const running = refreshing.get(userId);
  if (running) return running;
  const run = refreshRepoAccess(userId)
    .then((): RefreshResult => 'refreshed')
    .catch(async (err: unknown): Promise<RefreshResult> => {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof GithubTokenError) {
        await revokeAccess(userId);
        logger.info({ userId, err: message }, 'GitHub rejected the user authorization; access revoked');
        return 'signed-out';
      }
      logger.warn({ userId, err: message }, 'repo access refresh failed; GitHub unreachable');
      return 'unavailable';
    })
    .finally(() => refreshing.delete(userId));
  refreshing.set(userId, run);
  return run;
}

/** When GitHub cannot be reached, a snapshot younger than this is still used. */
export const MAX_SNAPSHOT_AGE_MS = 24 * 3600_000;

const signInAgain = () =>
  new HttpError(401, 'UNAUTHORIZED', 'Your GitHub authorization ended. Sign in again to continue.');

/**
 * True when the user has no GitHub authorization Revo can use (never signed
 * in through GitHub, or GitHub revoked it): they must sign in again.
 */
export async function needsGithubSignIn(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { accessTokenEnc: true } });
  return !user?.accessTokenEnc;
}

/**
 * Ids of the repos the user may see (spec 14: every dashboard query is
 * filtered by these). Refreshes the snapshot when older than an hour (spec 11).
 * Fails closed: when GitHub rejects the user's authorization the snapshot is
 * deleted and the request answers 401 (sign in again); when GitHub cannot be
 * reached, the last snapshot is used for at most 24 hours, then 503.
 */
export async function accessibleRepoIds(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accessCheckedAt: true, accessTokenEnc: true },
  });
  if (!user?.accessTokenEnc) throw signInAgain();
  const age = user.accessCheckedAt ? Date.now() - user.accessCheckedAt.getTime() : Number.POSITIVE_INFINITY;
  if (age > REPO_ACCESS_TTL_MS) {
    const result = await refreshOnce(userId);
    if (result === 'signed-out') throw signInAgain();
    if (result === 'unavailable' && age > MAX_SNAPSHOT_AGE_MS)
      throw new HttpError(503, 'INTERNAL', 'GitHub cannot be reached to check your access. Try again soon.');
  }
  const rows = await prisma.repoAccess.findMany({ where: { userId }, select: { repoId: true } });
  return rows.map((r) => r.repoId);
}

/** Throws NOT_FOUND (never FORBIDDEN, to avoid leaking existence) when the repo is not accessible. */
export async function assertRepoAccess(userId: string, repoId: string): Promise<void> {
  const ids = await accessibleRepoIds(userId);
  if (!ids.includes(repoId)) throw notFound('Repo');
}

/** The user's role on a repo they can access (NOT_FOUND otherwise). */
export async function repoPermission(userId: string, repoId: string): Promise<RepoPermission> {
  await assertRepoAccess(userId, repoId);
  const row = await prisma.repoAccess.findUnique({
    where: { userId_repoId: { userId, repoId } },
    select: { permission: true },
  });
  if (!row) throw notFound('Repo');
  return row.permission;
}
