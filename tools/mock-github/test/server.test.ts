import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_REPOS, DEMO_USER, DEMO_USER_LIMITED } from '@revo/db/fixtures';
import { createMockGithubServer } from '../src/server';

let base = '';
const { server } = createMockGithubServer({ baseUrl: 'http://localhost' });

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function signIn(login?: string) {
  if (login) await fetch(`${base}/__mock/user`, { method: 'POST', body: new URLSearchParams({ login }) });
  const authorize = await fetch(
    `${base}/login/oauth/authorize?client_id=x&state=abc&redirect_uri=${encodeURIComponent('http://app/cb')}`,
    { redirect: 'manual' },
  );
  const location = new URL(authorize.headers.get('location')!);
  expect(location.searchParams.get('state')).toBe('abc');
  const tokenRes = await fetch(`${base}/login/oauth/access_token`, {
    method: 'POST',
    headers: { accept: 'application/json' },
    body: new URLSearchParams({ code: location.searchParams.get('code')!, grant_type: 'authorization_code' }),
  });
  return (await tokenRes.json()) as { access_token: string; refresh_token: string };
}

describe('mock GitHub', () => {
  it('runs the OAuth flow and serves the user', async () => {
    const tokens = await signIn();
    const user = await (
      await fetch(`${base}/user`, { headers: { authorization: `Bearer ${tokens.access_token}` } })
    ).json();
    expect(user).toMatchObject({ id: DEMO_USER.githubId, login: DEMO_USER.login });
  });

  it('lists the installations and repos a user can access', async () => {
    const tokens = await signIn(DEMO_USER_LIMITED.login);
    const auth = { authorization: `token ${tokens.access_token}` };
    const inst = (await (await fetch(`${base}/user/installations`, { headers: auth })).json()) as {
      installations: { id: number }[];
    };
    const repos = (await (
      await fetch(`${base}/user/installations/${inst.installations[0]!.id}/repositories`, { headers: auth })
    ).json()) as { repositories: { id: number }[] };
    expect(repos.repositories.map((r) => r.id)).toEqual([DEMO_REPOS[0].githubId]);
  });

  it('shows a new installation to its members only', async () => {
    const created = await fetch(`${base}/__mock/installations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 4242, login: 'acme', repos: [{ id: 4243, name: 'shop' }] }),
    });
    expect(created.status).toBe(201);
    const listFor = async (login: string) => {
      const tokens = await signIn(login);
      const auth = { authorization: `token ${tokens.access_token}` };
      const inst = (await (await fetch(`${base}/user/installations`, { headers: auth })).json()) as {
        installations: { id: number; account: { login: string } }[];
      };
      return inst.installations.map((i) => i.account.login);
    };
    expect(await listFor(DEMO_USER.login)).toEqual(['northwind-labs', 'acme']);
    expect(await listFor(DEMO_USER_LIMITED.login)).toEqual(['northwind-labs']);
    const tokens = await signIn(DEMO_USER.login);
    const repos = (await (
      await fetch(`${base}/user/installations/4242/repositories`, {
        headers: { authorization: `token ${tokens.access_token}` },
      })
    ).json()) as { repositories: { full_name: string }[] };
    expect(repos.repositories.map((r) => r.full_name)).toEqual(['acme/shop']);
  });

  it('registers an app from a manifest and converts the code once', async () => {
    const manifest = { name: 'Revo Test', redirect_url: 'http://localhost:3832/callback' };
    const created = await fetch(`${base}/organizations/acme/settings/apps/new?state=s1`, {
      method: 'POST',
      body: new URLSearchParams({ manifest: JSON.stringify(manifest) }),
      redirect: 'manual',
    });
    expect(created.status).toBe(302);
    const location = new URL(created.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(manifest.redirect_url);
    expect(location.searchParams.get('state')).toBe('s1');
    const code = location.searchParams.get('code')!;

    const conversion = await fetch(`${base}/app-manifests/${code}/conversions`, { method: 'POST' });
    expect(conversion.status).toBe(201);
    expect(await conversion.json()).toMatchObject({ slug: 'revo-test', owner: { login: 'acme' } });
    expect((await fetch(`${base}/app-manifests/${code}/conversions`, { method: 'POST' })).status).toBe(404);
  });

  it('refreshes tokens and rejects bad credentials', async () => {
    const tokens = await signIn(DEMO_USER.login);
    const refreshed = (await (
      await fetch(`${base}/login/oauth/access_token`, {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }),
      })
    ).json()) as { access_token: string };
    expect(refreshed.access_token).toMatch(/^ghu_mock_/);
    expect((await fetch(`${base}/user`, { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
  });
});
