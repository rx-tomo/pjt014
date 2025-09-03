import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  // Reduce parallelism to limit concurrent contexts (helps context budget)
  workers: Number(process.env.PW_WORKERS || 1),
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3014',
    // Keep artifacts lean to save context and disk
    screenshot: (process.env.PW_SCREENSHOT as 'off' | 'on' | 'only-on-failure') || 'only-on-failure',
    video: (process.env.PW_VIDEO as 'off' | 'on' | 'retain-on-failure') || 'off',
    trace: (process.env.PW_TRACE as 'off' | 'on' | 'retain-on-failure' | 'on-first-retry') || 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        // Smaller viewport + default scale to keep failure screenshots compact
        ...devices['Desktop Chrome'],
        viewport: {
          width: Number(process.env.PW_VIEWPORT_W || 960),
          height: Number(process.env.PW_VIEWPORT_H || 600),
        },
        deviceScaleFactor: 1,
      },
    },
  ],
});
