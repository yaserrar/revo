import { randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { headCheck, mockPullRequest, routeWebhooksToApp, signIn } from './support/pull-request';
import { mock, MOCK_URL, startWorker, waitFor, type RunningWorker } from './support/services';

/**
 * One-click fixes, feedback from GitHub and fixes across pushes, end to end:
 * a PR with an off-by-one loop gets an inline comment with a GitHub suggested
 * change; a 👍 on it becomes feedback; pushing the suggested line fixes the
 * finding, Revo resolves its thread and the dashboard shows what was fixed.
 */

const installationId = 940_000_000 + randomInt(1, 9_999_999);
const owner = `e2e-fixes-${installationId}`;
const fullName = `${owner}/cart`;
const PR_TITLE = `Cart total ${installationId}`;
const pr = mockPullRequest(fullName);

const CART = [
  'export function cartTotal(items: { price: number }[]): number {',
  '  let sum = 0;',
  '  for (let i = 0; i <= items.length; i++) {',
  '    sum += items[i].price;',
  '  }',
  '  return sum;',
  '}',
  '',
].join('\n');
const FIXED_LINE = '  for (let i = 0; i < items.length; i++) {';

type Thread = { commentId: number; isResolved: boolean; resolvedBy: string | null };
type FullActivity = Awaited<ReturnType<typeof pr.activity>> & {
  reviewComments: { id: number; path: string; line: number; body: string }[];
  threads: Thread[];
};
const activity = () => pr.activity() as Promise<FullActivity>;

let worker: RunningWorker;
let pullRequestId = '';
let commentId = 0;

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test.beforeAll(async () => {
  await routeWebhooksToApp();
  worker = await startWorker();
  await mock('/__mock/installations', {
    id: installationId,
    login: owner,
    repos: [{ id: installationId + 1, name: 'cart' }],
  });
});

test.afterAll(async () => {
  await worker?.stop();
  await fetch(`${MOCK_URL}/__mock/installations/${installationId}/uninstall`, { method: 'POST' });
});

test.beforeEach(async ({ page }) => signIn(page));

test('the fix is offered as a one-click suggested change, on GitHub and in the dashboard', async ({
  page,
}) => {
  await pr.open({ title: PR_TITLE, author: 'sam-okafor', files: [{ path: 'src/cart.ts', after: CART }] });
  const done = (await pr.completedHeadCheck()) as FullActivity;
  const [comment] = done.reviewComments;
  expect(comment).toMatchObject({ path: 'src/cart.ts', line: 3 });
  expect(comment!.body).toContain(`\`\`\`suggestion\n${FIXED_LINE}\n\`\`\``);
  commentId = comment!.id;

  await page.goto(`/prs?q=${encodeURIComponent(String(installationId))}`);
  await page
    .getByRole('link', { name: new RegExp(PR_TITLE) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/prs\/[^/?]+$/);
  pullRequestId = new URL(page.url()).pathname.split('/').at(-1)!;

  const card = page.locator('article', { hasText: 'Loop reads one element past the end' });
  await expect(card.getByText('One click on GitHub: Apply suggestion')).toBeVisible();
  const change = card.getByRole('region', { name: 'Suggested change' });
  await expect(change).toContainText('Removed:   for (let i = 0; i <= items.length; i++) {');
  await expect(change).toContainText(`Added: ${FIXED_LINE}`);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: process.env.REVO_SHOTS ? `${process.env.REVO_SHOTS}/suggested.png` : undefined,
    fullPage: false,
  });
});

test('pushing the suggested line resolves the thread, lists the fix, and counts 👍 and the fix as useful', async ({
  page,
}) => {
  await mock(`/__mock/repos/${fullName}/pulls/${pr.number}/comments/${commentId}/reactions`, {
    content: '+1',
    login: 'jonas-weber',
  });
  const before = await activity();
  await pr.push([
    { path: 'src/cart.ts', after: CART.replace('  for (let i = 0; i <= items.length; i++) {', FIXED_LINE) },
  ]);
  const done = await waitFor(
    activity,
    (a) => a.headSha !== before.headSha && headCheck(a)?.status === 'completed',
    { what: 'the review of the fix' },
  );
  expect(headCheck(done)).toMatchObject({ conclusion: 'success', title: 'Score 100/100, good to merge' });
  expect(done.threads.find((t) => t.commentId === commentId)).toMatchObject({
    isResolved: true,
    resolvedBy: 'revo-dev[bot]',
  });
  expect(done.comments[0]!.body).toContain('### Fixed since the last review (1)');
  expect(done.reviewComments).toHaveLength(1);

  await page.goto(`/prs/${pullRequestId}`);
  const fixed = page.getByRole('region', { name: /Fixed by this commit · 1/ });
  await expect(fixed).toBeVisible();
  await page.screenshot({
    path: process.env.REVO_SHOTS ? `${process.env.REVO_SHOTS}/fixed-panel.png` : undefined,
    fullPage: true,
  });

  // It opens the review that found it: fixed in the new commit, 👍 and the fix counted.
  await fixed.getByRole('button', { name: /Loop reads one element past the end/ }).click();
  const card = page.locator('article', { hasText: 'Loop reads one element past the end' });
  await expect(card.getByText(`Fixed in ${done.headSha.slice(0, 7)}`)).toBeVisible();
  await expect(card.getByText('2 useful · 0 wrong')).toBeVisible();
  await expect(card.getByText('(1 from GitHub, fixed in a later push)')).toBeVisible();
  await page.screenshot({
    path: process.env.REVO_SHOTS ? `${process.env.REVO_SHOTS}/fixed-card.png` : undefined,
    fullPage: false,
  });
});

test('fits a phone screen in dark mode, with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const shot = (name: string) =>
    process.env.REVO_SHOTS
      ? page.screenshot({ path: `${process.env.REVO_SHOTS}/${name}.png`, fullPage: true })
      : null;

  await page.goto(`/prs/${pullRequestId}`);
  await expect(page.getByRole('region', { name: /Fixed by this commit/ })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await shot('mobile-dark-fixed');

  await page
    .getByRole('region', { name: /Fixed by this commit/ })
    .getByRole('button')
    .click();
  await expect(page.getByRole('region', { name: 'Suggested change' })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(0);
  await shot('mobile-dark-card');
});
