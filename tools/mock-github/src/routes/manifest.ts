import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { MOCK_APP_ID } from '../app-state';
import type { MockRoute } from '../router';

/**
 * GitHub's App manifest flow (github.com/settings/apps/new → redirect with a
 * code → POST /app-manifests/:code/conversions), auto-confirmed, for testing
 * `pnpm github:app` with GITHUB_WEB_URL and GITHUB_API_URL at the mock.
 */
export function manifestRoutes(): MockRoute[] {
  const pending = new Map<string, { name: string; owner: string }>();

  const create: MockRoute['handler'] = ({ body, url, params }) => {
    let manifest: { name?: unknown; redirect_url?: unknown };
    try {
      manifest = JSON.parse(body.manifest ?? '') as typeof manifest;
    } catch {
      return { status: 422, json: { message: 'manifest must be JSON' } };
    }
    if (typeof manifest.redirect_url !== 'string' || typeof manifest.name !== 'string')
      return { status: 422, json: { message: 'manifest needs name and redirect_url' } };
    const code = randomBytes(10).toString('hex');
    pending.set(code, { name: manifest.name, owner: params.org ?? 'maya-chen' });
    const redirect = new URL(manifest.redirect_url);
    redirect.searchParams.set('code', code);
    const state = url.searchParams.get('state');
    if (state) redirect.searchParams.set('state', state);
    return { status: 302, headers: { location: redirect.toString() } };
  };

  return [
    { method: 'POST', path: '/settings/apps/new', handler: create },
    { method: 'POST', path: '/organizations/:org/settings/apps/new', handler: create },
    {
      method: 'POST',
      path: '/app-manifests/:code/conversions',
      handler: ({ params }) => {
        const app = pending.get(params.code ?? '');
        if (!app) return { status: 404, json: { message: 'Not Found' } };
        pending.delete(params.code ?? '');
        const slug = app.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const { privateKey } = generateKeyPairSync('rsa', {
          modulusLength: 2048,
          privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
          publicKeyEncoding: { type: 'spki', format: 'pem' },
        });
        return {
          status: 201,
          json: {
            id: MOCK_APP_ID,
            slug,
            html_url: `https://github.com/apps/${slug}`,
            owner: { login: app.owner },
            client_id: `Iv23mock${randomBytes(6).toString('hex')}`,
            client_secret: randomBytes(20).toString('hex'),
            webhook_secret: randomBytes(20).toString('hex'),
            pem: privateKey,
          },
        };
      },
    },
  ];
}
