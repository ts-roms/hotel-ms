import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests (ADR-0029). They run against a stack that is already up:
 * locally the dev servers, in CI a production build started by the workflow, and on
 * staging the deployed site (smoke tests only: `--grep @smoke`).
 *
 *   E2E_WEB_URL    staff app (default http://localhost:43100)
 *   E2E_GUEST_URL  guest portal (default http://localhost:43200)
 *   E2E_EMAIL / E2E_PASSWORD  a front-desk login (default: the demo seed's reception user)
 */
export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:43100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: '.auth/staff.json' },
    },
  ],
});
