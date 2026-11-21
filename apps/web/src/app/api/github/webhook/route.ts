import { handleGithubWebhook } from '~/server/modules/github/webhook.handler';

export const dynamic = 'force-dynamic';

/** GitHub App webhook: pull_request, installation and installation_repositories events. */
export const POST = handleGithubWebhook;
