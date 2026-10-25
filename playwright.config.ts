import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:4173',
    viewport: { width: 402, height: 874 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    {
      name: 'webkit',
      use: {
        browserName: 'webkit',
        launchOptions: process.env.BOOK_WEBKIT_EXECUTABLE
          ? { executablePath: process.env.BOOK_WEBKIT_EXECUTABLE }
          : undefined,
      },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'npm run preview -- --port 4173', port: 4173, reuseExistingServer: true },
});
