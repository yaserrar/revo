import { randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { headCheck, mockPullRequest, routeWebhooksToApp, signIn, TOTAL_BUGGY } from './support/pull-request';
import type { PullRequestDetailDto } from '~/types/pull-request';
import { mock, MOCK_URL, rootEnv, startWorker, waitFor, type RunningWorker } from './support/services';

/**
 * The real path with the real Claude API, on one PR (a few cents with Sonnet
 * 5.5). Skipped unless REVO_E2E_CLAUDE=1 and ANTHROPIC_API_KEY is set in the
 * root .env:
 *
 *   REVO_E2E_CLAUDE=1 pnpm --filter @revo/web test:e2e e2e/claude.spec.ts
 *
 * GitHub is still the mock; only the review goes to Claude.
 */
const enabled = process.env.REVO_E2E_CLAUDE === '1' && Boolean(rootEnv().ANTHROPIC_API_KEY);
test.skip(!enabled, 'Set REVO_E2E_CLAUDE=1 and ANTHROPIC_API_KEY in .env to call the real Claude API');

const installationId = 940_000_000 + randomInt(1, 9_999_999);
const owner = `claude-${installationId}`;
const pr = mockPullRequest(`${owner}/checkout`);
let worker: RunningWorker;

test.setTimeout(6 * 60_000);

test.beforeAll(async () => {
  await routeWebhooksToApp();
  worker = await startWorker({ REVO_ENGINE: 'claude' });
});

test.afterAll(async () => {
  await worker?.stop();
  await fetch(`${MOCK_URL}/__mock/installations/${installationId}/uninstall`, { method: 'POST' });
});

test('Claude Sonnet 5.5 reviews a PR with a known bug end to end', async ({ page }) => {
  await signIn(page);
  await mock('/__mock/installations', {
    id: installationId,
    login: owner,
    repos: [{ id: installationId + 1, name: 'checkout' }],
  });
  await pr.open({
    title: `Apply promo codes at checkout ${installationId}`,
    body: 'Promo codes take a fixed amount off the order total.',
    files: [{ path: 'src/checkout/total.ts', after: TOTAL_BUGGY }],
  });

  const done = await pr.completedHeadCheck(5 * 60_000);
  const check = headCheck(done)!;
  expect(check.title).toMatch(/^Score \d+\/100/);
  expect(done.comments[0]?.body).toContain('<!-- revo:summary -->');
  // The worker logged real Claude calls (usage only, never code or the key).
  expect(worker.output()).toContain('claude call');
  expect(worker.output()).not.toContain(rootEnv().ANTHROPIC_API_KEY!);

  const list = (await (await page.request.get(`/api/prs?q=${installationId}`)).json()) as {
    items: { id: string }[];
  };
  const id = list.items[0]!.id;
  const detail = await waitFor(
    () => page.request.get(`/api/prs/${id}`).then((r) => r.json() as Promise<PullRequestDetailDto>),
    (d) => d.reviews[0]?.status === 'done',
    { what: 'the review in the dashboard' },
  );
  const review = detail.reviews[0]!;
  expect(review.model).toBe('claude-sonnet-5-5');
  expect(review.inputTokens).toBeGreaterThan(0);
  console.log(
    `Claude review: score ${review.score}, cost $${review.costUsd.toFixed(4)}, check "${check.title}"`,
  );
  await page.goto(`/prs/${id}`);
  await expect(page.getByText('Claude Sonnet 5.5')).toBeVisible();
});
