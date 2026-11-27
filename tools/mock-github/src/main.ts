import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMockGithubServer } from './server';

// The repo's .env gives the webhook secret and the app URL (never overrides the shell).
const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const port = Number(process.env.MOCK_GITHUB_PORT ?? 4830);
const baseUrl = `http://localhost:${port}`;
const { server, app } = createMockGithubServer({ baseUrl });

// Webhooks go to the Revo web app: MOCK_WEBHOOK_URL, or APP_URL + /api/github/webhook.
// Change it at runtime with POST /__mock/webhook { url, secret }.
// `||`, not `??`: the .env written by setup:local has an empty MOCK_WEBHOOK_URL=.
const webhookUrl =
  process.env.MOCK_WEBHOOK_URL ||
  (process.env.APP_URL ? `${process.env.APP_URL.replace(/\/$/, '')}/api/github/webhook` : undefined);
const secret = process.env.GITHUB_WEBHOOK_SECRET;
if (webhookUrl && secret) app.webhookTarget = { url: webhookUrl, secret };

server.listen(port, () => {
  console.log(`mock GitHub on ${baseUrl}`);
  console.log(
    app.webhookTarget ? `webhooks → ${app.webhookTarget.url}` : 'webhooks: no target (POST /__mock/webhook)',
  );
});

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
