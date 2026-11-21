import { expect, test } from '@playwright/test';

test('the design kit renders every section without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/dev/kit');
  await expect(page.getByRole('img', { name: /Score 72 out of 100, needs a look/ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chips' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBe(0);
});

test('the command menu opens with Ctrl+K and navigates', async ({ page }) => {
  await page.goto('/dev/kit');
  await page.waitForLoadState('networkidle');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command menu' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Type a command or search…').fill('dark');
  await expect(dialog.getByRole('option', { name: 'Dark theme' })).toBeVisible();
});
