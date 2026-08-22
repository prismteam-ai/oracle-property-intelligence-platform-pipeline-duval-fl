import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // sequential for demo flow
  workers: 1, // single worker to avoid parallel run interference
  retries: 0,
  use: {
    baseURL: 'https://d5sfa8vgu8mcx.cloudfront.net',
    video: 'on', // record all tests as demo artifacts
    screenshot: 'on',
    trace: 'on-first-retry',
  },
  outputDir: './results',
  reporter: [['html', { open: 'never' }], ['list']],
  projects: [
    { name: 'chromium', use: { channel: 'chrome' } },
  ],
});
