import { defineConfig, devices } from '@playwright/test'

/*
 * There is deliberately no `webServer` here. One shared server would serialise
 * the suite — the app is single-replica by design (SQLite is a single writer,
 * the socket fan-out is in-process) — and every worker would see every other
 * worker's rooms. Instead `e2e-tests/server.ts` starts a real server with a
 * real database per worker, and the `backend` fixture in `pcTest.ts` hands its
 * URL to `baseURL`.
 *
 * The client is built once in globalSetup and served by those servers, exactly
 * as in production, so there is no dev server and no proxy in the picture.
 */
export default defineConfig({
  testDir: './e2e-tests/tests',
  globalSetup: './e2e-tests/globalSetup.ts',

  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // One server process and one browser per worker, so this is bounded by the
  // machine rather than by anything shared.
  workers: process.env.CI ? '50%' : undefined,

  reporter: [['list'], ['html', { open: 'never' }]],

  expect: { timeout: 5_000 },

  use: {
    // baseURL comes from the per-worker `backend` fixture.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
