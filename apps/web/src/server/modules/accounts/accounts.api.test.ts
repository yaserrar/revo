/**
 * AI access API against the test database (TEST_DATABASE_URL via vitest.config.ts):
 * the route handlers end to end with a stubbed session, access snapshot and key check
 * (never Anthropic). Who may change it, that the key never comes back, that a
 * refused key changes nothing, and the free-tier rules of the repo settings
 * and "Review again". Creates its own installation and users, deletes them after.
 */
import { randomInt } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserDto } from '@revo/shared';
import { prisma } from '../../config/prisma';
import { decryptSecret } from '../../security/crypto';

const session = vi.hoisted(() => ({ user: null as UserDto | null }));
vi.mock('~/server/auth/session', () => ({
  getSessionUser: async () => session.user,
  requireUser: async () => session.user,
}));
// Access comes from the RepoAccess rows written below, never refreshed from GitHub (other test
// files mark every user's snapshot stale when they change an installation's repos).
vi.mock('~/server/auth/repo-access', async () => {
  const { prisma: db } = await import('~/server/config/prisma');
  const { notFound } = await import('~/server/http/errors');
  const rows = (userId: string) => db.repoAccess.findMany({ where: { userId } });
  return {
    accessibleRepoIds: async (userId: string) => (await rows(userId)).map((r) => r.repoId),
    assertRepoAccess: async (userId: string, repoId: string) => {
      if (!(await rows(userId)).some((r) => r.repoId === repoId)) throw notFound('Repo');
    },
    repoPermission: async (userId: string, repoId: string) => {
      const row = (await rows(userId)).find((r) => r.repoId === repoId);
      if (!row) throw notFound('Repo');
      return row.permission;
    },
    needsGithubSignIn: async () => false,
  };
});
const keyCheck = vi.hoisted(() => ({ result: 'valid' as 'valid' | 'refused' | 'unavailable', calls: 0 }));
vi.mock('./anthropic-key', () => ({
  checkAnthropicKey: async () => {
    keyCheck.calls++;
    return keyCheck.result;
  },
}));

const accountsRoute = await import('~/app/api/accounts/route');
const keyRoute = await import('~/app/api/accounts/[id]/anthropic-key/route');
const accessRoute = await import('~/app/api/accounts/[id]/ai-access/route');
const settingsRoute = await import('~/app/api/repos/[id]/settings/route');
const { pullRequestsService } = await import('../pull-requests/pull-requests.service');

const base = 700_000_000 + randomInt(1, 90_000_000);
const login = `ai-access-${base}`;
const KEY = 'sk-ant-api03-test-key-never-returned-WXYZ';
const OTHER_KEY = 'sk-ant-api03-another-key-refused-QRST';

const ids = { installation: '', repoA: '', repoB: '', pr: '' };
const users: Record<'admin' | 'writer' | 'outsider', UserDto> = {} as never;

function request(method: string, path: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function call(
  as: keyof typeof users,
  handler: (req: NextRequest, c: { params: Promise<unknown> }) => Promise<Response>,
  method: string,
  path: string,
  options: { id?: string; body?: unknown } = {},
) {
  session.user = users[as];
  const res = await handler(request(method, path, options.body), ctx(options.id ?? ''));
  const text = await res.text();
  return { status: res.status, text, json: text ? (JSON.parse(text) as Record<string, unknown>) : null };
}

const installationRow = () => prisma.installation.findUniqueOrThrow({ where: { id: ids.installation } });

async function makeUser(n: number, name: string): Promise<UserDto> {
  const user = await prisma.user.create({
    data: {
      githubId: base + 100 + n,
      login: `${name}-${base}`,
    },
  });
  return { id: user.id, githubId: Number(user.githubId), login: user.login, name: null, avatarUrl: null };
}

beforeAll(async () => {
  const installation = await prisma.installation.create({
    data: { githubId: base, accountLogin: login, accountType: 'Organization', accountGithubId: base },
  });
  ids.installation = installation.id;
  const repoA = await prisma.repo.create({
    data: { githubId: base + 1, fullName: `${login}/alpha`, installationId: installation.id },
  });
  const repoB = await prisma.repo.create({
    data: { githubId: base + 2, fullName: `${login}/beta`, installationId: installation.id },
  });
  ids.repoA = repoA.id;
  ids.repoB = repoB.id;
  users.admin = await makeUser(1, 'admin');
  users.writer = await makeUser(2, 'writer');
  users.outsider = await makeUser(3, 'outsider');
  await prisma.repoAccess.createMany({
    data: [
      // Admin on one repo of the account is enough.
      { userId: users.admin.id, repoId: repoA.id, permission: 'admin' },
      { userId: users.admin.id, repoId: repoB.id, permission: 'read' },
      { userId: users.writer.id, repoId: repoA.id, permission: 'maintain' },
      { userId: users.writer.id, repoId: repoB.id, permission: 'maintain' },
    ],
  });
  const pr = await prisma.pullRequest.create({
    data: {
      repoId: repoA.id,
      number: 1,
      title: 'Add checkout',
      author: 'ana',
      baseRef: 'main',
      headRef: 'feat/checkout',
      headSha: 'a'.repeat(40),
      url: `https://github.com/${login}/alpha/pull/1`,
      state: 'open',
      openedAt: new Date(),
    },
  });
  ids.pr = pr.id;
});

afterAll(async () => {
  await prisma.installation.deleteMany({ where: { id: ids.installation } });
  await prisma.freeTierUsage.deleteMany({ where: { accountLogin: login } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  keyCheck.result = 'valid';
  keyCheck.calls = 0;
});

const keyPath = () => `/api/accounts/${ids.installation}/anthropic-key`;
const accessPath = () => `/api/accounts/${ids.installation}/ai-access`;

describe('GET /api/accounts', () => {
  it('lists the accounts the user can see, on the free tier, editable only by admins', async () => {
    const admin = await call('admin', accountsRoute.GET, 'GET', '/api/accounts');
    expect(admin.status).toBe(200);
    const [account] = admin.json!.items as Record<string, unknown>[];
    expect(account).toMatchObject({
      aiAccess: 'free',
      effective: 'free',
      keyHint: null,
      canEdit: true,
      freeTier: { used: 0, limit: 20, paused: false },
    });
    expect(admin.json!.subscriptionAllowed).toBe(false);

    const writer = await call('writer', accountsRoute.GET, 'GET', '/api/accounts');
    expect((writer.json!.items as Record<string, unknown>[])[0]).toMatchObject({ canEdit: false });

    const outsider = await call('outsider', accountsRoute.GET, 'GET', '/api/accounts');
    expect(outsider.json!.items).toEqual([]);
  });
});

describe('PUT /api/accounts/[id]/anthropic-key', () => {
  it('needs the Admin role (403) and hides other accounts (404), without checking the key', async () => {
    const writer = await call('writer', keyRoute.PUT, 'PUT', keyPath(), {
      id: ids.installation,
      body: { apiKey: KEY },
    });
    expect(writer.status).toBe(403);
    const outsider = await call('outsider', keyRoute.PUT, 'PUT', keyPath(), {
      id: ids.installation,
      body: { apiKey: KEY },
    });
    expect(outsider.status).toBe(404);
    expect(keyCheck.calls).toBe(0);
    expect(await installationRow()).toMatchObject({ aiAccess: 'free', anthropicKeyEnc: null });
  });

  it('refuses something that is not an Anthropic key before calling Anthropic', async () => {
    const res = await call('admin', keyRoute.PUT, 'PUT', keyPath(), {
      id: ids.installation,
      body: { apiKey: 'not-a-key-at-all-but-long-enough' },
    });
    expect(res.status).toBe(400);
    expect(keyCheck.calls).toBe(0);
  });

  it('changes nothing when Anthropic refuses the key or cannot be reached', async () => {
    keyCheck.result = 'refused';
    const refused = await call('admin', keyRoute.PUT, 'PUT', keyPath(), {
      id: ids.installation,
      body: { apiKey: KEY },
    });
    expect(refused.status).toBe(422);
    expect(refused.json!.message).toMatch(/did not accept this key/);

    keyCheck.result = 'unavailable';
    const down = await call('admin', keyRoute.PUT, 'PUT', keyPath(), {
      id: ids.installation,
      body: { apiKey: KEY },
    });
    expect(down.status).toBe(503);
    expect(await installationRow()).toMatchObject({
      aiAccess: 'free',
      anthropicKeyEnc: null,
      anthropicKeyHint: null,
      aiAccessUpdatedAt: null,
    });
  });

  it('saves a valid key encrypted, switches to it, and never returns it', async () => {
    const res = await call('admin', keyRoute.PUT, 'PUT', keyPath(), {
      id: ids.installation,
      body: { apiKey: `  ${KEY} ` },
    });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(KEY);
    expect(res.text).not.toContain('test-key');
    expect(res.json).toMatchObject({
      aiAccess: 'own_key',
      effective: 'own_key',
      keyHint: 'WXYZ',
      freeTier: null,
      updatedBy: users.admin.login,
    });

    const row = await installationRow();
    expect(row.anthropicKeyEnc).not.toContain(KEY);
    expect(decryptSecret(row.anthropicKeyEnc!)).toBe(KEY);
    expect(row).toMatchObject({
      aiAccess: 'own_key',
      anthropicKeyHint: 'WXYZ',
      aiAccessUpdatedBy: users.admin.id,
    });

    const list = await call('writer', accountsRoute.GET, 'GET', '/api/accounts');
    expect(list.text).not.toContain(KEY);
    expect(list.text).not.toContain(row.anthropicKeyEnc);
  });

  it('keeps the saved key when a replacement is refused', async () => {
    const before = await installationRow();
    keyCheck.result = 'refused';
    const res = await call('admin', keyRoute.PUT, 'PUT', keyPath(), {
      id: ids.installation,
      body: { apiKey: OTHER_KEY },
    });
    expect(res.status).toBe(422);
    const after = await installationRow();
    expect(after.anthropicKeyEnc).toBe(before.anthropicKeyEnc);
    expect(after.anthropicKeyHint).toBe('WXYZ');
    expect(after.aiAccessUpdatedAt).toEqual(before.aiAccessUpdatedAt);
  });
});

describe('repo settings and the account key', () => {
  it('allows Opus with the account key', async () => {
    const res = await call('writer', settingsRoute.PATCH, 'PATCH', `/api/repos/${ids.repoA}/settings`, {
      id: ids.repoA,
      body: { model: 'claude-opus-5-5' },
    });
    expect(res.status).toBe(200);
    expect(res.json!.model).toBe('claude-opus-5-5');
  });
});

describe('PATCH /api/accounts/[id]/ai-access', () => {
  it('needs the Admin role, a saved key for own_key, and a server that offers the subscription', async () => {
    const writer = await call('writer', accessRoute.PATCH, 'PATCH', accessPath(), {
      id: ids.installation,
      body: { aiAccess: 'free' },
    });
    expect(writer.status).toBe(403);

    const subscription = await call('admin', accessRoute.PATCH, 'PATCH', accessPath(), {
      id: ids.installation,
      body: { aiAccess: 'subscription' },
    });
    expect(subscription.status).toBe(422);
    expect((await installationRow()).aiAccess).toBe('own_key');

    const free = await call('admin', accessRoute.PATCH, 'PATCH', accessPath(), {
      id: ids.installation,
      body: { aiAccess: 'free' },
    });
    expect(free.status).toBe(200);
    // The key stays saved (shown by its hint) but is not used.
    expect(free.json).toMatchObject({ aiAccess: 'free', effective: 'free', keyHint: 'WXYZ' });

    const back = await call('admin', accessRoute.PATCH, 'PATCH', accessPath(), {
      id: ids.installation,
      body: { aiAccess: 'own_key' },
    });
    expect(back.json).toMatchObject({ effective: 'own_key' });
  });
});

describe('DELETE /api/accounts/[id]/anthropic-key', () => {
  it('needs the Admin role, then deletes the key and goes back to the free tier', async () => {
    const writer = await call('writer', keyRoute.DELETE, 'DELETE', keyPath(), { id: ids.installation });
    expect(writer.status).toBe(403);
    expect((await installationRow()).anthropicKeyEnc).not.toBeNull();

    const admin = await call('admin', keyRoute.DELETE, 'DELETE', keyPath(), { id: ids.installation });
    expect(admin.status).toBe(200);
    expect(admin.json).toMatchObject({ aiAccess: 'free', effective: 'free', keyHint: null });
    expect(await installationRow()).toMatchObject({ anthropicKeyEnc: null, anthropicKeyHint: null });

    const own = await call('admin', accessRoute.PATCH, 'PATCH', accessPath(), {
      id: ids.installation,
      body: { aiAccess: 'own_key' },
    });
    expect(own.status).toBe(422);
  });
});

describe('the free tier in the dashboard', () => {
  it('refuses switching a repo to Opus, but keeps an Opus repo saving its other settings', async () => {
    const toOpus = await call('writer', settingsRoute.PATCH, 'PATCH', `/api/repos/${ids.repoB}/settings`, {
      id: ids.repoB,
      body: { model: 'claude-opus-5-5' },
    });
    expect(toOpus.status).toBe(422);
    expect(toOpus.json!.message).toMatch(/needs your own Anthropic API key/);

    // repoA was set to Opus while the key was saved: saving the same model again is fine.
    const same = await call('writer', settingsRoute.PATCH, 'PATCH', `/api/repos/${ids.repoA}/settings`, {
      id: ids.repoA,
      body: { model: 'claude-opus-5-5', threshold: 75 },
    });
    expect(same.status).toBe(200);

    const page = await call('writer', settingsRoute.GET, 'GET', `/api/repos/${ids.repoB}/settings`, {
      id: ids.repoB,
    });
    expect(page.json!.aiAccess).toMatchObject({ accountLogin: login, effective: 'free' });
  });

  it('blocks "Review again" once the account used its free reviews', async () => {
    const open = await pullRequestsService.detail(ids.pr, [ids.repoA, ids.repoB], users.writer.id);
    expect(open.reviewAgain.allowed).toBe(true);

    // What the worker writes for 20 runs on Revo's key: the free-tier ledger, by account.
    await prisma.freeTierUsage.createMany({
      data: Array.from({ length: 20 }, () => ({ accountGithubId: base, accountLogin: login, costUsd: 0.01 })),
    });
    const used = await pullRequestsService.detail(ids.pr, [ids.repoA, ids.repoB], users.writer.id);
    expect(used.reviewAgain).toMatchObject({ allowed: false, block: 'free_limit' });
    expect(used.reviewAgain.reason).toContain(`Free reviews for ${login} are used up until`);
    await expect(
      pullRequestsService.reviewAgain(ids.pr, [ids.repoA, ids.repoB], users.writer.id),
    ).rejects.toMatchObject({ status: 409 });

    const list = await call('admin', accountsRoute.GET, 'GET', '/api/accounts');
    expect((list.json!.items as Record<string, unknown>[])[0]).toMatchObject({
      freeTier: { used: 20, limit: 20 },
    });

    // Removing a repo from the App (its rows cascade away) does not give the reviews back.
    await prisma.repo.delete({ where: { id: ids.repoB } });
    const after = await pullRequestsService.detail(ids.pr, [ids.repoA], users.writer.id);
    expect(after.reviewAgain).toMatchObject({ allowed: false, block: 'free_limit' });
  });
});
