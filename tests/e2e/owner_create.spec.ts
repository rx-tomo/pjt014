import { test, expect, request } from '@playwright/test';

test('owner can create change request and it appears in store', async ({ page, context }) => {
  // Ensure role cookie regardless of DEV mode or COOKIE_SECURE
  const base = process.env.BASE_URL || 'http://localhost:3014';
  await context.addCookies([{ name: 'role', value: 'owner', url: base }]);
  await page.goto('/'); // establish origin
  // Go to owner portal for loc1
  await page.goto('/owner/loc1');
  await expect(page.locator('#desc')).toBeVisible();
  await page.locator('#desc').fill('E2E description ' + Date.now());
  await page.locator('#owner_signoff').check();
  await page.getByRole('button', { name: '送信' }).click();
  // Minimal confirmation
  await expect(page.locator('#msg')).toContainText('送信しました', { timeout: 5000 });

  // Verify via diag endpoint
  const req = await request.newContext({ baseURL: process.env.BASE_URL || 'http://localhost:3014' });
  const res = await req.get('/__dev/diag?locId=loc1');
  expect(res.ok()).toBeTruthy();
  const json = await res.json();
  expect(json.ok).toBeTruthy();
  expect(json.store_loc_count).toBeGreaterThan(0);
});
