import { expect, test, type Page } from '@playwright/test';

/**
 * Dashboard pages against the seeded northwind-labs data (pnpm db:seed),
 * signed in through the mock GitHub. Mutations are undone at the end of each test.
 */
const MOCK = 'http://localhost:4830';

async function signIn(page: Page, login = 'maya-chen') {
  await page.request.post(`${MOCK}/__mock/user`, { form: { login } });
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
}

test.describe('signed in as maya-chen (every repo)', () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test('overview shows the bento, the 30-day chart and the latest reviews', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Maya');
    for (const label of ['Average score · 7 days', 'Reviewed · 7d', 'Precision · 30d']) {
      await expect(page.getByRole('heading', { name: label })).toBeVisible();
    }
    await expect(page.getByText('Average score · 30 days')).toBeVisible();
    const latest = page
      .getByRole('region', { name: /Fresh off the queue/ })
      .getByRole('listitem')
      .getByRole('link');
    await expect(latest).toHaveCount(10);
    await latest.nth(1).click();
    await expect(page).toHaveURL(/\/prs\/[^/?]+\?review=/);
  });

  test('pull requests filter, search and paginate through the URL', async ({ page }) => {
    await page.goto('/prs');
    await expect(page.getByText(/of 42/)).toBeVisible();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page).toHaveURL(/page=2/);

    await page.getByRole('button', { name: 'State' }).click();
    await page.getByRole('option', { name: 'Merged' }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/state=merged/);
    await expect(page).not.toHaveURL(/page=2/);
    const merged = page.locator('tbody tr');
    await expect(merged.first()).toContainText('Merged');

    await page.getByRole('button', { name: 'Has blockers' }).click();
    await expect(page).toHaveURL(/blockers=yes/);
    await expect(page.locator('tbody tr').first()).toContainText(/[1-9]\d* blockers?,/);

    await page.getByRole('button', { name: 'Reset' }).click();
    await page.getByRole('searchbox', { name: 'Search pull requests' }).fill('promo');
    await expect(page).toHaveURL(/q=promo/);
    await expect(page.locator('tbody tr')).not.toHaveCount(0);
    for (const row of await page.locator('tbody tr a').allTextContents())
      expect(row.toLowerCase()).toContain('promo');

    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Search pull requests' })).toHaveValue('promo');
  });

  test('a PR shows its score, breakdown, findings and takes feedback', async ({ page }) => {
    await page.goto('/prs?state=merged&blockers=yes');
    await page.locator('tbody tr a').first().click();
    await expect(page).toHaveURL(/\/prs\/[^/?]+$/);

    await expect(page.getByRole('img', { name: /Score \d+ out of 100/ }).first()).toBeVisible();
    await expect(page.getByText('Every point lost has a reason')).toBeVisible();
    await expect(page.getByRole('heading', { name: /\d+ findings?/ })).toBeVisible();
    await expect(page.getByText('Only open pull requests are reviewed.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review again' })).toBeDisabled();

    const card = page.locator('article').first();
    const useful = card.getByRole('button', { name: 'Useful' });
    const wasPressed = (await useful.getAttribute('aria-pressed')) === 'true';
    await useful.click();
    await expect(useful).toHaveAttribute('aria-pressed', wasPressed ? 'false' : 'true');
    await expect(page.getByText(wasPressed ? 'Feedback removed' : 'Marked useful')).toBeVisible();

    if (!wasPressed) {
      await card.getByRole('button', { name: 'Add a note' }).click();
      await card.getByRole('textbox', { name: 'Note for this feedback' }).fill('Confirmed in staging');
      await card.getByRole('button', { name: 'Save note' }).click();
      await expect(card.getByText('“Confirmed in staging”')).toBeVisible();
    }
    // Restore the seeded state.
    await useful.click();
    await expect(useful).toHaveAttribute('aria-pressed', wasPressed ? 'true' : 'false');

    const rejected = page.getByRole('button', { name: /Rejected by verification/ });
    if (await rejected.count()) {
      await rejected.click();
      await expect(page.getByText('Why it was rejected').first()).toBeVisible();
    }
    await expect(page.getByText('Run details')).toBeVisible();
    await expect(page.getByText('Tokens in')).toBeVisible();
  });

  test('repo settings validate, save and restore', async ({ page }) => {
    await page.goto('/repos');
    await expect(
      page.getByRole('switch', { name: 'Reviews for northwind-labs/storefront' }).first(),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Settings for northwind-labs/api' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'api' })).toBeVisible();

    await page.getByRole('textbox', { name: 'New pattern' }).fill('/abs/**');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Use a path relative to the repo root (no leading /).')).toBeVisible();

    const instructions = page.getByRole('textbox', { name: 'Custom instructions' });
    const original = await instructions.inputValue();
    await instructions.fill(`${original} Money is in cents.`);
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Settings saved')).toBeVisible();
    await page.reload();
    await expect(instructions).toHaveValue(`${original} Money is in cents.`);

    await instructions.fill(original);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toBeHidden();
  });

  test('trends keep the period in the URL', async ({ page }) => {
    await page.goto('/trends');
    await expect(page.getByText('Score by repo')).toBeVisible();
    await page.getByRole('radio', { name: '7 days' }).click();
    await expect(page).toHaveURL(/range=7d/);
    await expect(page.getByText('Average score per day · 7 days')).toBeVisible();
    await expect(page.getByText('Hot files')).toBeVisible();
  });

  test('the command menu searches pull requests', async ({ page }) => {
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Command menu' });
    await dialog.getByPlaceholder('Type a command or search…').fill('promo');
    const option = dialog.getByRole('option', { name: /promo/i }).first();
    await expect(option).toBeVisible();
    await option.click();
    await expect(page).toHaveURL(/\/prs\/[^/?]+$/);
  });

  test('every page fits a phone without sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    for (const path of ['/', '/overview', '/prs', '/repos', '/trends']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await noOverflow(page);
    }
    await page.goto('/prs');
    await page.getByRole('button', { name: 'Score', exact: true }).click();
    await expect(page.getByText('Score range')).toBeVisible();
    await noOverflow(page);
    await page.keyboard.press('Escape');

    // Long built-in globs wrap inside their chips.
    const repos = await (await page.request.get('/api/repos')).json();
    await page.goto(`/repos/${repos.items[0].id}/settings`);
    await page.getByRole('button', { name: /Always ignored/ }).click();
    await expect(
      page.getByText('**/*.{zip,gz,tgz,tar,rar,7z,jar,wasm,pdf,exe,dll,so,dylib,bin}'),
    ).toBeVisible();
    await noOverflow(page);
  });
});

test('access is limited to the repos a user can see on GitHub', async ({ browser }) => {
  // A PR of another repo, found as maya (who sees every repo).
  const mayaContext = await browser.newContext();
  const maya = await mayaContext.newPage();
  await signIn(maya);
  const all = await (await maya.request.get('/api/prs?pageSize=100')).json();
  const other = all.items.find(
    (p: { repo: { fullName: string } }) => p.repo.fullName !== 'northwind-labs/storefront',
  );
  await mayaContext.close();

  const jonasContext = await browser.newContext();
  const page = await jonasContext.newPage();
  await signIn(page, 'jonas-weber');
  await page.request.post(`${MOCK}/__mock/user`, { form: { login: 'maya-chen' } });

  const repos = await (await page.request.get('/api/repos')).json();
  expect(repos.items.map((r: { fullName: string }) => r.fullName)).toEqual(['northwind-labs/storefront']);
  const prs = await (await page.request.get('/api/prs?pageSize=100')).json();
  expect(new Set(prs.items.map((p: { repo: { fullName: string } }) => p.repo.fullName))).toEqual(
    new Set(['northwind-labs/storefront']),
  );

  expect((await page.request.get(`/api/prs/${other.id}`)).status()).toBe(404);
  expect((await page.request.get(`/api/repos/${other.repo.id}/settings`)).status()).toBe(404);
  await page.goto(`/prs/${other.id}`);
  await expect(page.getByText('Pull request not found')).toBeVisible();

  // Jonas only reads storefront on GitHub: its settings are view only, and the API refuses changes.
  const storefront = repos.items[0] as { id: string };
  const patch = await page.request.patch(`/api/repos/${storefront.id}/settings`, {
    data: { monthlyBudgetUsd: 10_000, model: 'claude-opus-5-5' },
  });
  expect(patch.status()).toBe(403);
  await page.goto(`/repos/${storefront.id}/settings`);
  await expect(
    page.getByText(/View only\. Changing these settings needs the Maintain or Admin role/),
  ).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Reviews enabled' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: 'Custom instructions' })).toBeDisabled();
  const storefrontPr = prs.items[0] as { id: string };
  expect((await page.request.post(`/api/prs/${storefrontPr.id}/review-again`)).status()).toBe(403);
  await jonasContext.close();
});

test('sign-in never redirects off site', async ({ page }) => {
  await signIn(page);
  for (const target of ['/%5Cattacker.test/phish', '/%09/attacker.test', '//attacker.test']) {
    const res = await page.request.get(`/sign-in?callbackUrl=${target}`, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toBe('/overview');
  }
});
