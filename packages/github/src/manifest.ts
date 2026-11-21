import { z } from 'zod';

/**
 * GitHub App registration from a manifest (spec 6). GitHub's manifest flow:
 * 1. POST a form with `manifest` (JSON) to github.com/settings/apps/new
 *    (or /organizations/<org>/settings/apps/new) with a `state`;
 * 2. the user confirms, GitHub redirects to `redirect_url?code=…&state=…`;
 * 3. POST /app-manifests/<code>/conversions (no auth, within an hour) returns
 *    the app id, slug, OAuth client id/secret, webhook secret and private key.
 * `installation` and `installation_repositories` events are always sent to
 * GitHub Apps, so only `pull_request` is subscribed explicitly.
 */

/** Spec 6: what the app may do. Metadata read is implied but stated for clarity. */
export const APP_PERMISSIONS = {
  pull_requests: 'write',
  checks: 'write',
  contents: 'read',
  metadata: 'read',
} as const;

export const APP_EVENTS = ['pull_request'] as const;

export type AppManifest = {
  name: string;
  url: string;
  description: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  callback_urls: string[];
  setup_url: string;
  setup_on_update: boolean;
  public: boolean;
  request_oauth_on_install: boolean;
  default_permissions: typeof APP_PERMISSIONS;
  default_events: (typeof APP_EVENTS)[number][];
};

/** Dashboard URL without a trailing slash; must be https except for localhost. */
export function normaliseAppUrl(appUrl: string): string {
  const url = new URL(appUrl);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !local)
    throw new Error('The app URL must use https (GitHub requires it).');
  return url.origin + url.pathname.replace(/\/+$/, '');
}

/**
 * The manifest for a Revo deployment at `appUrl`. `redirectUrl` is where
 * GitHub sends the one-time code (the local helper that exchanges it).
 * `dashboardUrl` is where people open the dashboard when it differs from the
 * public URL that receives webhooks (local development behind a tunnel: the
 * webhook goes through the tunnel, sign-in stays on http://localhost:3830).
 */
export function buildAppManifest(input: {
  appUrl: string;
  redirectUrl: string;
  name?: string;
  dashboardUrl?: string;
}): AppManifest {
  const base = normaliseAppUrl(input.appUrl);
  const dashboard = input.dashboardUrl ? normaliseAppUrl(input.dashboardUrl) : base;
  const signInBases = dashboard === base ? [base] : [dashboard, base];
  return {
    name: input.name ?? 'Revo',
    url: dashboard,
    description:
      'Reviews pull requests with Claude: few comments, an explainable score out of 100, measured precision and visible cost.',
    hook_attributes: { url: `${base}/api/github/webhook`, active: true },
    redirect_url: input.redirectUrl,
    // Auth.js GitHub provider callback (sign-in to the dashboard).
    callback_urls: signInBases.map((b) => `${b}/api/auth/callback/github`),
    // After installing, GitHub sends the user back to the repo list.
    setup_url: `${dashboard}/repos`,
    setup_on_update: true,
    public: false,
    request_oauth_on_install: false,
    default_permissions: APP_PERMISSIONS,
    default_events: [...APP_EVENTS],
  };
}

/** The page the manifest form posts to: a personal account or an organization. */
export function manifestFormAction(webBaseUrl: string, state: string, org?: string): string {
  const base = webBaseUrl.replace(/\/$/, '');
  const path = org ? `/organizations/${encodeURIComponent(org)}/settings/apps/new` : '/settings/apps/new';
  return `${base}${path}?state=${encodeURIComponent(state)}`;
}

const ConversionSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  html_url: z.string(),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  webhook_secret: z.string().min(1),
  pem: z.string().min(1),
  owner: z.object({ login: z.string() }).nullish(),
});
export type ManifestConversion = z.infer<typeof ConversionSchema>;

/** Step 3: trades the one-time code for the new app's credentials. */
export async function convertManifestCode(apiUrl: string, code: string): Promise<ManifestConversion> {
  if (!/^[\w-]+$/.test(code)) throw new Error('Invalid manifest code.');
  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/app-manifests/${code}/conversions`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Revo',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok)
    throw new Error(`GitHub answered ${res.status} to the manifest conversion (codes expire after 1 hour).`);
  return ConversionSchema.parse(await res.json());
}

/** The .env lines for a new app (the PEM on one line with "\n" escapes). */
export function credentialsEnvBlock(app: ManifestConversion): string {
  return [
    `GITHUB_APP_ID=${app.id}`,
    `GITHUB_APP_SLUG=${app.slug}`,
    `GITHUB_CLIENT_ID=${app.client_id}`,
    `GITHUB_CLIENT_SECRET=${app.client_secret}`,
    `GITHUB_WEBHOOK_SECRET=${app.webhook_secret}`,
    `GITHUB_APP_PRIVATE_KEY="${app.pem.trim().replace(/\r?\n/g, '\\n')}"`,
  ].join('\n');
}
