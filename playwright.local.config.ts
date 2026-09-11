/*
 * TEMPORARY, sandbox-only. Two differences from playwright.config.ts:
 *
 *  - the pre-installed Chromium here is an older build than @playwright/test
 *    expects, so every project is pointed at it explicitly;
 *  - the temporary visual-snapshot specs are routed to the right viewport.
 *
 * Delete together with e2e-tests/tests/snap-*.test.ts.
 */
import { defineConfig, devices } from '@playwright/test'

const launchOptions = { executablePath: process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium' }

export default defineConfig({
  testDir: './e2e-tests/tests',
  globalSetup: './e2e-tests/globalSetup.ts',
  fullyParallel: true,
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : undefined,
  reporter: [['list']],
  expect: { timeout: 5_000, toHaveScreenshot: { maxDiffPixels: 0 } },
  use: { trace: 'off', screenshot: 'off', video: 'off', launchOptions },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions },
      testIgnore: /shift\.test\.ts|snap-phone\.test\.ts/,
    },
    {
      name: 'phone',
      use: { ...devices['Pixel 7'], launchOptions },
      testMatch: /shift\.test\.ts|snap-phone\.test\.ts/,
    },
  ],
})
