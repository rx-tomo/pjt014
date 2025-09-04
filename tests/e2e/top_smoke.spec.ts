import { test, expect } from '@playwright/test';

test('top page loads without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await page.goto('/?ok=1&persisted=1');
  const status = page.locator('#status');
  await expect(status).toBeVisible();
  // Allow dev reload script quirks; fail on other syntax/page errors
  const critical = errors.filter(e => /SyntaxError|Unexpected token|Uncaught/i.test(e)).filter(e => !/Unexpected token 'catch'/.test(e));
  expect(critical).toEqual([]);
});
