import { randomInt } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrismaClient } from '@revo/db';
import { DEMO_USER } from '@revo/db/fixtures';
import { createMockGithubServer } from '@revo/mock-github';
import type * as RepoAccessModule from './repo-access';
import type * as CryptoModule from '../security/crypto';

// Integration: revo_test + the mock GitHub in process. The hourly repo-access
// refresh (spec 14: every query is limited to the repos the user can access).
const prisma = createPrismaClient({ connectionString: process.env.DATABASE_URL });
const { server, state, app } = createMockGithubServer({ baseUrl: 'http://localhost' });
const installationId = 700_000_000 + randomInt(1, 99_999_999);
const [repoA, repoB] = [installationId + 1, installationId + 2];
const HOUR = 3600_000;

let access: typeof RepoAccessModule;
let crypto: typeof CryptoModule;
let userId = '';
let repoIds: Record<number, string> = {};

function signInTokens() {
  state.nextLogin = DEMO_USER.login;
  return state.exchangeCode(state.issueCode())!;
}

async function setUser(data: {
  accessCheckedAt: Date | null;
  accessToken?: string;
  accessTokenExpiresAt?: Date | null;
  refreshToken?: string;
}) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      accessCheckedAt: data.accessCheckedAt,
      ...(data.accessToken ? { accessTokenEnc: crypto.encryptSecret(data.accessToken) } : {}),
      ...(data.accessTokenExpiresAt !== undefined ? { accessTokenExpiresAt: data.accessTokenExpiresAt } : {}),
      ...(data.refreshToken ? { refreshTokenEnc: crypto.encryptSecret(data.refreshToken) } : {}),
    },
  });
}

const sorted = (ids: string[]) => [...ids].sort();

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  Object.assign(process.env, {
    GITHUB_API_URL: url,
    GITHUB_OAUTH_BASE_URL: url,
    GITHUB_CLIENT_ID: 'test-client',
    GITHUB_CLIENT_SECRET: 'test-secret',
  });
  access = await import('./repo-access');
  crypto = await import('../security/crypto');

  app.addInstallation({
    id: installationId,
    account: { id: installationId, login: `access-${installationId}`, type: 'Organization' },
    repos: [
      { id: repoA, name: 'a' },
      { id: repoB, name: 'b' },
    ],
    members: [DEMO_USER.login],
  });
  const installation = await prisma.installation.create({
    data: {
      githubId: BigInt(installationId),
      accountLogin: `access-${installationId}`,
      accountType: 'Organization',
    },
  });
  for (const id of [repoA, repoB]) {
    const repo = await prisma.repo.create({
      data: {
        githubId: BigInt(id),
        fullName: `access-${installationId}/${id}`,
        installationId: installation.id,
      },
    });
    repoIds[id] = repo.id;
  }
  const user = await prisma.user.create({
    data: { githubId: BigInt(installationId), login: `access-test-${installationId}` },
  });
  userId = user.id;
});

beforeEach(async () => {
  const tokens = signInTokens();
  await setUser({
    accessCheckedAt: null,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
  });
  await prisma.repoAccess.deleteMany({ where: { userId } });
  if (!app.repos.has(repoB)) app.addRepos(installationId, [{ id: repoB, name: 'b' }]);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.installation.deleteMany({ where: { githubId: BigInt(installationId) } });
  await prisma.$disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  repoIds = {};
});

describe('repo access snapshot', () => {
  it('is read from GitHub when missing and kept for an hour', async () => {
    expect(sorted(await access.accessibleRepoIds(userId))).toEqual(
      sorted([repoIds[repoA]!, repoIds[repoB]!]),
    );

    // GitHub now hides repo B, but the snapshot is fresh: no new GitHub call.
    app.removeRepos([repoB]);
    await setUser({ accessCheckedAt: new Date(Date.now() - HOUR + 60_000) });
    expect(sorted(await access.accessibleRepoIds(userId))).toEqual(
      sorted([repoIds[repoA]!, repoIds[repoB]!]),
    );
  });

  it('is refreshed from GitHub once it is older than an hour', async () => {
    await access.accessibleRepoIds(userId);
    app.removeRepos([repoB]);
    await setUser({ accessCheckedAt: new Date(Date.now() - HOUR - 60_000) });

    expect(await access.accessibleRepoIds(userId)).toEqual([repoIds[repoA]]);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(Date.now() - user.accessCheckedAt!.getTime()).toBeLessThan(60_000);
    await expect(access.assertRepoAccess(userId, repoIds[repoB]!)).rejects.toMatchObject({ status: 404 });
  });

  it('uses the refresh token when the 8-hour user token expired', async () => {
    await setUser({
      accessCheckedAt: null,
      accessToken: 'ghu_expired',
      accessTokenExpiresAt: new Date(Date.now() - 1000),
    });
    expect(sorted(await access.accessibleRepoIds(userId))).toEqual(
      sorted([repoIds[repoA]!, repoIds[repoB]!]),
    );
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(crypto.decryptSecret(user.accessTokenEnc!)).toMatch(/^ghu_mock_/);
  });

  it('records the user’s role on each repo', async () => {
    await access.accessibleRepoIds(userId);
    const rows = await prisma.repoAccess.findMany({ where: { userId }, select: { permission: true } });
    expect(rows.map((r) => r.permission)).toEqual(['admin', 'admin']);
    expect(await access.repoPermission(userId, repoIds[repoA]!)).toBe('admin');
  });

  it('fails closed when GitHub rejects the token: snapshot and tokens gone, 401', async () => {
    await access.accessibleRepoIds(userId);
    await setUser({ accessCheckedAt: null, accessToken: 'ghu_revoked', accessTokenExpiresAt: null });
    await expect(access.accessibleRepoIds(userId)).rejects.toMatchObject({ status: 401 });
    expect(await prisma.repoAccess.count({ where: { userId } })).toBe(0);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user).toMatchObject({ accessTokenEnc: null, refreshTokenEnc: null });
    expect(await access.needsGithubSignIn(userId)).toBe(true);
    // Every later request asks to sign in again, even with a fresh check time.
    await setUser({ accessCheckedAt: new Date() });
    await expect(access.accessibleRepoIds(userId)).rejects.toMatchObject({ status: 401 });
  });

  it('keeps a recent snapshot while GitHub is unreachable, for at most a day', async () => {
    await access.accessibleRepoIds(userId);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    try {
      await setUser({ accessCheckedAt: new Date(Date.now() - 2 * HOUR) });
      expect(sorted(await access.accessibleRepoIds(userId))).toEqual(
        sorted([repoIds[repoA]!, repoIds[repoB]!]),
      );
      await setUser({ accessCheckedAt: new Date(Date.now() - 25 * HOUR) });
      await expect(access.accessibleRepoIds(userId)).rejects.toMatchObject({ status: 503 });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('shares one refresh between concurrent requests', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => access.accessibleRepoIds(userId)));
    for (const ids of results) expect(sorted(ids)).toEqual(sorted([repoIds[repoA]!, repoIds[repoB]!]));
    expect(await prisma.repoAccess.count({ where: { userId } })).toBe(2);
  });
});
