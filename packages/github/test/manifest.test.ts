import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_EVENTS,
  APP_PERMISSIONS,
  buildAppManifest,
  convertManifestCode,
  credentialsEnvBlock,
  manifestFormAction,
  normaliseAppUrl,
} from '../src/manifest';

const conversion = {
  id: 1234,
  slug: 'revo-acme',
  html_url: 'https://github.com/apps/revo-acme',
  client_id: 'Iv23abc',
  client_secret: 'shh',
  webhook_secret: 'whsec',
  pem: '-----BEGIN RSA PRIVATE KEY-----\nAAA\nBBB\n-----END RSA PRIVATE KEY-----\n',
  owner: { login: 'acme' },
};

afterEach(() => vi.unstubAllGlobals());

describe('GitHub App manifest', () => {
  it('has the spec 6 permissions, events and Revo URLs', () => {
    const m = buildAppManifest({
      appUrl: 'https://revo.example.com/',
      redirectUrl: 'http://localhost:3832/callback',
    });
    expect(m).toMatchObject({
      name: 'Revo',
      url: 'https://revo.example.com',
      hook_attributes: { url: 'https://revo.example.com/api/github/webhook', active: true },
      callback_urls: ['https://revo.example.com/api/auth/callback/github'],
      setup_url: 'https://revo.example.com/repos',
      redirect_url: 'http://localhost:3832/callback',
      public: false,
    });
    expect(m.default_permissions).toEqual({
      pull_requests: 'write',
      checks: 'write',
      contents: 'read',
      metadata: 'read',
    });
    expect(m.default_events).toEqual(['pull_request']);
    expect(APP_PERMISSIONS).toBe(m.default_permissions);
    expect(APP_EVENTS).toEqual(['pull_request']);
  });

  it('keeps webhooks on the tunnel and sign-in on the local dashboard', () => {
    const m = buildAppManifest({
      appUrl: 'https://quiet-owl.ngrok-free.app',
      redirectUrl: 'http://localhost:3832/callback',
      dashboardUrl: 'http://localhost:3830/',
    });
    expect(m).toMatchObject({
      url: 'http://localhost:3830',
      hook_attributes: { url: 'https://quiet-owl.ngrok-free.app/api/github/webhook' },
      callback_urls: [
        'http://localhost:3830/api/auth/callback/github',
        'https://quiet-owl.ngrok-free.app/api/auth/callback/github',
      ],
      setup_url: 'http://localhost:3830/repos',
    });
  });

  it('requires https except on localhost', () => {
    expect(() => normaliseAppUrl('http://revo.example.com')).toThrow(/https/);
    expect(normaliseAppUrl('http://localhost:3830/')).toBe('http://localhost:3830');
    expect(normaliseAppUrl('https://example.com/revo/')).toBe('https://example.com/revo');
  });

  it('posts to the account or organization page with the state', () => {
    expect(manifestFormAction('https://github.com/', 'abc')).toBe(
      'https://github.com/settings/apps/new?state=abc',
    );
    expect(manifestFormAction('https://github.com', 'abc', 'acme')).toBe(
      'https://github.com/organizations/acme/settings/apps/new?state=abc',
    );
  });

  it('exchanges the code and renders single-line env values', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(conversion), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = await convertManifestCode('https://api.github.com/', 'code123');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/app-manifests/code123/conversions',
      expect.objectContaining({ method: 'POST' }),
    );
    const block = credentialsEnvBlock(app);
    expect(block.split('\n')).toEqual([
      'GITHUB_APP_ID=1234',
      'GITHUB_APP_SLUG=revo-acme',
      'GITHUB_CLIENT_ID=Iv23abc',
      'GITHUB_CLIENT_SECRET=shh',
      'GITHUB_WEBHOOK_SECRET=whsec',
      'GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\nAAA\\nBBB\\n-----END RSA PRIVATE KEY-----"',
    ]);
  });

  it('rejects odd codes and failed conversions', async () => {
    await expect(convertManifestCode('https://api.github.com', '../x')).rejects.toThrow(/Invalid/);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );
    await expect(convertManifestCode('https://api.github.com', 'expired')).rejects.toThrow(/404/);
  });
});
