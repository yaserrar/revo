import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { expect, test } from '@playwright/test';
import {
  headCheck,
  LEGACY_REPORT,
  mockPullRequest,
  routeWebhooksToApp,
  signIn,
  TOTAL_BUGGY,
  TOTAL_FIXED,
} from './support/pull-request';
import { mock, MOCK_URL, rootEnv, startWorker, waitFor, type RunningWorker } from './support/services';

/**
 * The whole product against the mock GitHub: install → PR reviewed (check,
 * summary comment, inline comments) → dashboard → feedback → settings change
 * reflected by "Review again" → fix pushed (same comment, "→ 100") → $0 budget
 * (neutral "Monthly budget reached") → Claude failure (neutral "couldn't
 * review") → uninstall deletes everything.
 *
 * Needs the web app with REVIEW_DEBOUNCE_SECONDS=2 (playwright.config.ts starts
 * it so) and starts its own worker (fake engine, then a failing Claude API).
 */

const installationId = 930_000_000 + randomInt(1, 9_999_999);
const repoGithubId = installationId + 1;
const owner = `e2e-${installationId}`;
const fullName = `${owner}/checkout`;
const PR_TITLE = `Promo codes at checkout ${installationId}`;
const pr = mockPullRequest(fullName);

let worker: RunningWorker;
let pullRequestId = '';
let repoId = '';

const activity = pr.activity;
const completedHeadCheck = () => pr.completedHeadCheck();
const push = pr.push;

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

test.beforeAll(async () => {
  await routeWebhooksToApp();
  worker = await startWorker();
});

test.afterAll(async () => {
  await worker?.stop();
  // A failed run must not leave its installation behind (the dashboard tests count the seeded PRs).
  await fetch(`${MOCK_URL}/__mock/installations/${installationId}/uninstall`, { method: 'POST' });
});

test.beforeEach(async ({ page }) => signIn(page));

test('installing the app lists the repo as waiting for its first PR', async ({ page }) => {
  const created = await mock<{ delivery: { status: number } }>('/__mock/installations', {
    id: installationId,
    login: owner,
    repos: [{ id: repoGithubId, name: 'checkout' }],
  });
  expect(created.delivery.status).toBe(200);

  // Signed in before the install: the webhook marked repo access stale, so the next page load refreshes it.
  await page.goto('/repos');
  const row = page
    .getByRole('row', { name: new RegExp(fullName) })
    .or(page.locator('article', { hasText: fullName }));
  await expect(row.first()).toContainText('Waiting for the first PR');
  const repos = (await (await page.request.get('/api/repos')).json()) as {
    items: { id: string; fullName: string }[];
  };
  repoId = repos.items.find((r) => r.fullName === fullName)!.id;
});

test('a buggy PR gets a red check, one summary comment and inline comments', async ({ page }) => {
  await pr.open({
    title: PR_TITLE,
    body: 'Adds promo codes to the order total and a legacy report.',
    author: 'sam-okafor',
    files: [
      { path: 'src/checkout/total.ts', after: TOTAL_BUGGY },
      { path: 'src/legacy/report.ts', after: LEGACY_REPORT },
    ],
  });

  const reviewing = await waitFor(activity, (a) => Boolean(headCheck(a)), { what: 'the reviewing check' });
  expect(headCheck(reviewing)?.title).toBe('Revo: reviewing…');

  const done = await completedHeadCheck();
  expect(headCheck(done)).toMatchObject({ conclusion: 'failure' });
  expect(headCheck(done)?.title).toMatch(/^Score \d+\/100, changes needed$/);
  expect(done.comments).toHaveLength(1);
  expect(done.comments[0]!.body).toContain('<!-- revo:summary -->');
  expect(done.comments[0]!.body).toContain('Discount applied after tax');
  expect(done.reviewComments.map((c) => c.path).sort()).toEqual([
    'src/checkout/total.ts',
    'src/legacy/report.ts',
  ]);

  // The dashboard has the PR, its score and both findings.
  await page.goto(`/prs?q=${encodeURIComponent(String(installationId))}`);
  await page
    .getByRole('link', { name: new RegExp(PR_TITLE) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/prs\/[^/?]+$/);
  pullRequestId = new URL(page.url()).pathname.split('/').at(-1)!;
  await expect(page.getByRole('img', { name: /Score \d+ out of 100/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '2 findings' })).toBeVisible();
  await expect(page.getByText('SQL built from request input')).toBeVisible();
  await expect(page.getByText('Discount applied after tax')).toBeVisible();
});

test('marking a finding useful updates the precision rate', async ({ page }) => {
  const precision = async () =>
    ((await (await page.request.get('/api/overview')).json()) as { precision: { useful: number } }).precision;
  const before = await precision();

  await page.goto(`/prs/${pullRequestId}`);
  const card = page.locator('article', { hasText: 'Discount applied after tax' });
  await card.getByRole('button', { name: 'Useful' }).click();
  await expect(card.getByRole('button', { name: 'Useful' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Marked useful')).toBeVisible();

  await expect.poll(async () => (await precision()).useful).toBe(before.useful + 1);
  await page.goto('/overview');
  await expect(page.getByRole('heading', { name: 'Precision · 30d' })).toBeVisible();
});

test('changing the model and ignored files changes the next review', async ({ page }) => {
  await page.goto(`/repos/${repoId}/settings`);
  await page.getByText('Haiku 5.5', { exact: true }).click();
  await page.getByRole('textbox', { name: 'New pattern' }).fill('src/legacy/**');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();

  await page.goto(`/prs/${pullRequestId}`);
  await page.getByRole('button', { name: 'Review again' }).click();
  await expect(page.getByText('Review queued')).toBeVisible();

  const done = await waitFor(
    () => page.request.get(`/api/prs/${pullRequestId}`).then((r) => r.json()),
    (pr: { reviews: { status: string; model: string; filesReviewed: number }[] }) =>
      pr.reviews[0]?.status === 'done' && pr.reviews[0].model === 'claude-haiku-5-5',
    { what: 'the manual review with the new settings' },
  );
  expect(done.reviews[0]?.filesReviewed).toBe(1);

  await page.reload();
  await expect(page.getByRole('heading', { name: '1 finding' })).toBeVisible();
  await expect(page.getByText('SQL built from request input')).toBeHidden();
  await expect(page.getByText('Claude Haiku 5.5')).toBeVisible();
});

test('pushing the fix edits the same comment with the score change and turns the check green', async ({
  page,
}) => {
  const before = await activity();
  await push([{ path: 'src/checkout/total.ts', after: TOTAL_FIXED }]);
  const done = await waitFor(
    activity,
    (a) => a.headSha !== before.headSha && headCheck(a)?.status === 'completed',
    { what: 'the review of the fix' },
  );
  expect(headCheck(done)).toMatchObject({ conclusion: 'success', title: 'Score 100/100, good to merge' });
  expect(done.comments).toHaveLength(1);
  expect(done.comments[0]!.id).toBe(before.comments[0]!.id);
  expect(done.comments[0]!.body).toMatch(/Previous review: \d+ → 100/);
  // Inline comments of the earlier review stay; none are added for the clean commit.
  expect(done.reviewComments).toHaveLength(before.reviewComments.length);

  await page.goto(`/prs/${pullRequestId}`);
  await expect(page.getByRole('img', { name: 'Score 100 out of 100' }).first()).toBeVisible();
  await expect(page.getByText('No problems found')).toBeVisible();
});

test('a $0 budget stops reviews with a neutral "Monthly budget reached" check', async ({ page }) => {
  const patch = (monthlyBudgetUsd: number) =>
    page.request.patch(`/api/repos/${repoId}/settings`, { data: { monthlyBudgetUsd } });
  expect((await patch(0)).ok()).toBe(true);

  await push([{ path: 'src/checkout/notes.md', after: 'Promo codes apply before tax.\n' }]);
  const done = await completedHeadCheck();
  expect(headCheck(done)).toMatchObject({ conclusion: 'neutral', title: 'Monthly budget reached' });

  await page.goto(`/prs/${pullRequestId}`);
  await expect(page.getByRole('heading', { name: 'Skipped: monthly budget reached' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review again' })).toBeDisabled();

  expect((await patch(20)).ok()).toBe(true);
});

test('a failed Claude call shows as a neutral "couldn\'t review" and the worker keeps running', async ({
  page,
}) => {
  await worker.stop();
  await mock('/__mock/anthropic', { status: 401 });
  worker = await startWorker({
    REVO_ENGINE: 'claude',
    ANTHROPIC_API_KEY: 'sk-ant-e2e-invalid',
    ANTHROPIC_BASE_URL: `${MOCK_URL}/anthropic`,
  });
  try {
    await push([
      { path: 'src/checkout/total.ts', after: `${TOTAL_FIXED}// rounding handled by the caller\n` },
    ]);
    const done = await completedHeadCheck();
    expect(headCheck(done)).toMatchObject({ conclusion: 'neutral', title: "Revo couldn't review this PR" });

    await page.goto(`/prs/${pullRequestId}`);
    await expect(page.getByRole('heading', { name: 'Revo couldn’t review this commit' })).toBeVisible();
    await expect(page.getByText(/API key/i)).toBeVisible();
    expect(worker.output()).not.toContain('sk-ant-e2e-invalid');
  } finally {
    await worker.stop();
    worker = await startWorker();
  }
});

test('uninstalling the app deletes the installation, repos, PRs, reviews and findings', async ({ page }) => {
  const reviewId = (
    (await (await page.request.get(`/api/prs/${pullRequestId}`)).json()) as {
      reviews: { id: string }[];
    }
  ).reviews[0]!.id;
  const res = await mock<{ delivery: { status: number } }>(
    `/__mock/installations/${installationId}/uninstall`,
    {},
  );
  expect(res.delivery.status).toBe(200);

  expect((await page.request.get(`/api/prs/${pullRequestId}`)).status()).toBe(404);
  expect((await page.request.get(`/api/reviews/${reviewId}`)).status()).toBe(404);
  expect((await page.request.get(`/api/repos/${repoId}/settings`)).status()).toBe(404);
  const repos = (await (await page.request.get('/api/repos')).json()) as { items: { fullName: string }[] };
  expect(repos.items.map((r) => r.fullName)).not.toContain(fullName);

  // And in the database itself (spec 14), not only hidden from the API.
  const count = (table: string, where: string) =>
    Number(
      execFileSync(
        'psql',
        [rootEnv().DATABASE_URL!, '-tAc', `SELECT count(*) FROM "${table}" WHERE ${where}`],
        {
          encoding: 'utf8',
        },
      ).trim(),
    );
  expect(count('Installation', `"githubId" = ${installationId}`)).toBe(0);
  expect(count('Repo', `"githubId" = ${repoGithubId}`)).toBe(0);
  expect(count('PullRequest', `id = '${pullRequestId}'`)).toBe(0);
  expect(count('Review', `id = '${reviewId}'`)).toBe(0);
  expect(count('Finding', `"reviewId" = '${reviewId}'`)).toBe(0);
});
