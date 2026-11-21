import { expect, test } from '@playwright/test';

test('signed-out visitors are sent to the sign-in page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('prove');
});

test('signing in with GitHub (mock) lands on the overview', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('button', { name: 'Sign in with GitHub' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );

  const me = await page.request.get('/api/me');
  expect(me.ok()).toBe(true);
  expect(await me.json()).toMatchObject({ login: 'maya-chen' });
});

test('API routes answer 401 with the error contract when signed out', async ({ request }) => {
  const res = await request.get('/api/me');
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ message: 'Sign in to continue.', code: 'UNAUTHORIZED' });
});
