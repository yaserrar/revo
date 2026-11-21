/**
 * Registers the Revo GitHub App from a manifest (spec 6), so nobody has to
 * copy permissions and URLs by hand:
 *
 *   pnpm github:app --url https://revo.example.com [--org my-org] [--name Revo] [--port 3832] [--out .env.github-app]
 *                   [--dashboard-url http://localhost:3830]
 *
 * --dashboard-url: local development behind a tunnel. Webhooks go to --url (the
 * tunnel), sign-in and the post-install page stay on the local dashboard.
 *
 * It serves a one-button page on http://localhost:<port>. The button posts the
 * manifest to GitHub; after you confirm, GitHub redirects back here with a
 * one-time code, which is exchanged for the app's credentials. They are written
 * to --out (mode 600, gitignored by `.env.*`) and printed, ready for `.env`.
 * GITHUB_WEB_URL / GITHUB_API_URL point it at another GitHub (e.g. the mock).
 */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildAppManifest,
  convertManifestCode,
  credentialsEnvBlock,
  manifestFormAction,
  normaliseAppUrl,
} from '../manifest';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    org: { type: 'string' },
    name: { type: 'string', default: 'Revo' },
    port: { type: 'string', default: '3832' },
    out: { type: 'string', default: '.env.github-app' },
    'dashboard-url': { type: 'string' },
  },
});

if (!values.url) {
  console.error(
    'Usage: pnpm github:app --url https://revo.example.com [--org my-org] [--name Revo] [--port 3832]',
  );
  process.exit(1);
}

const appUrl = normaliseAppUrl(values.url);
const port = Number(values.port);
const webUrl = process.env.GITHUB_WEB_URL ?? 'https://github.com';
const apiUrl = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const outFile = resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
const state = randomBytes(16).toString('hex');
const local = `http://localhost:${port}`;
const manifest = buildAppManifest({
  appUrl,
  redirectUrl: `${local}/callback`,
  name: values.name,
  dashboardUrl: values['dashboard-url'],
});

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; --paper: #faf9f6; --ink: #1c1a17; --muted: #6b655c; --accent: #2b3bff; }
  @media (prefers-color-scheme: dark) { :root { --paper: #121110; --ink: #f2efe9; --muted: #a59e93; --accent: #9aa2ff; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--paper); color: var(--ink);
    font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; padding: 16px; }
  main { max-width: 34rem; }
  h1 { font: 400 2.5rem/1.1 ui-serif, Georgia, serif; margin: 0 0 1rem; }
  p, li { color: var(--muted); }
  code { font: 0.875rem ui-monospace, monospace; }
  button { font: inherit; border: 0; border-radius: 999px; padding: 0.75rem 1.5rem; background: var(--accent); color: #fff; cursor: pointer; }
  @media (prefers-color-scheme: dark) { button { color: #121110; } }
</style></head><body><main>${body}</main></body></html>`;
}

const startPage = page(
  'Register Revo on GitHub',
  `<h1>Register ${escapeHtml(manifest.name)} on GitHub</h1>
<p>GitHub will create a private app for <code>${escapeHtml(values.org ?? 'your account')}</code> with:</p>
<ul>
  <li>Webhook <code>${escapeHtml(manifest.hook_attributes.url)}</code>, event <code>pull_request</code> (installation events are always sent)</li>
  <li>Sign-in callback <code>${escapeHtml(manifest.callback_urls[0]!)}</code></li>
  <li>Permissions: pull requests and checks read &amp; write, contents and metadata read</li>
</ul>
<form method="post" action="${escapeHtml(manifestFormAction(webUrl, state, values.org))}">
  <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
  <button type="submit">Create the GitHub App</button>
</form>`,
);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', local);
  const send = (status: number, html: string) => {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  };
  if (url.pathname === '/') return send(200, startPage);
  if (url.pathname !== '/callback') return send(404, page('Not found', '<h1>Not found</h1>'));

  const code = url.searchParams.get('code');
  if (!code || url.searchParams.get('state') !== state)
    return send(
      400,
      page('Invalid callback', '<h1>That link is not from this session</h1><p>Start again.</p>'),
    );

  convertManifestCode(apiUrl, code)
    .then((app) => {
      const block = credentialsEnvBlock(app);
      writeFileSync(outFile, `${block}\n`, { mode: 0o600 });
      console.log(`\nCreated GitHub App "${app.slug}" (id ${app.id}): ${app.html_url}`);
      console.log(`Credentials written to ${outFile} (mode 600). Add these lines to .env:\n`);
      console.log(block);
      console.log(`\nThen install it: ${app.html_url}/installations/new`);
      send(
        200,
        page(
          'Revo is registered',
          `<h1>${escapeHtml(app.slug)} is registered</h1><p>The credentials are in your terminal and in <code>${escapeHtml(values.out!)}</code>. You can close this tab.</p>`,
        ),
      );
      server.close();
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      send(
        502,
        page('Registration failed', '<h1>Registration failed</h1><p>See the terminal for details.</p>'),
      );
      server.close(() => process.exit(1));
    });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Open ${local} and click "Create the GitHub App".`);
  console.log(`Webhook: ${manifest.hook_attributes.url}`);
  console.log(`Callback: ${manifest.callback_urls[0]}`);
});
