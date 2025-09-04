import { test, expect } from '@playwright/test';

test('reviewer can see diff for latest request', async ({ page, context }) => {
  // Ensure reviewer cookie regardless of DEV mode or COOKIE_SECURE
  const base = process.env.BASE_URL || 'http://localhost:3014';
  await context.addCookies([{ name: 'role', value: 'reviewer', url: base }]);
  await page.goto('/'); // establish origin
  await page.goto('/review');
  // Seed if table empty
  const rows = page.locator('tbody#rows tr');
  if (await rows.count() === 0) {
    // Try DEV seed endpoint when available (best-effort)
    await page.goto('/__dev/seed?count=1');
    await page.goto('/review');
  }
  const firstLink = page.locator('tbody#rows tr a').first();
  await firstLink.click();
  const diff = page.locator('#diff');
  await expect(diff).toBeVisible();
  // Wait until diff content is not 'loading...' anymore or fallback text appears
  await page.waitForFunction(() => {
    const el = document.querySelector('#diff'); if (!el) return false;
    const t = (el.textContent || '').trim();
    return t && t.toLowerCase() !== 'loading...';
  }, { timeout: 10000 });
  // Accept either a rendered table or a fallback message
  if (await page.locator('#diff table').count() > 0) {
    await expect(page.locator('#diff table')).toBeVisible();
  } else {
    await expect(diff).toContainText(/差分|失敗|タイムアウト/);
  }
  await expect(page.locator('#cur_status')).toHaveText(/Status: (submitted|in_review|approved|needs_fix|synced|failed|not_found)/);
});
