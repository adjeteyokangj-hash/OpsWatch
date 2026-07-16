import { defineConfig, devices } from "@playwright/test";
import path from "path";

const artifactsDir = path.resolve(__dirname, "..", "..", "test-artifacts");

const chromeUse = {
  ...devices["Desktop Chrome"],
  channel: process.env.PLAYWRIGHT_CHANNEL || "chrome"
};

/** Independent workspace smoke groups — hard 60s each. */
const smokeTimeoutMs = 60_000;

export default defineConfig({
  testDir: "./e2e",
  // Default hard cap for smoke; longer journeys override via project.timeout.
  timeout: smokeTimeoutMs,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  // Keep running remaining groups when one fails.
  maxFailures: 0,
  reporter: [["list"]],
  outputDir: path.join(artifactsDir, "playwright-output"),
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 12_000,
    navigationTimeout: 20_000,
    // Avoid networkidle — topology/status polling keeps connections open.
    ignoreHTTPSErrors: true
  },
  projects: [
    {
      // Writes e2e/.auth/user.json for ensureSmokeAuth to reuse (soft share — not a hard gate).
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      timeout: smokeTimeoutMs,
      use: { ...chromeUse }
    },
    {
      name: "smoke-auth",
      testMatch: /smoke\/01-auth-session\.spec\.ts/,
      timeout: smokeTimeoutMs,
      use: { ...chromeUse }
    },
    {
      name: "smoke-monitoring",
      testMatch: /smoke\/02-core-monitoring\.spec\.ts/,
      timeout: smokeTimeoutMs,
      use: { ...chromeUse }
    },
    {
      name: "smoke-operations",
      testMatch: /smoke\/03-operations\.spec\.ts/,
      timeout: smokeTimeoutMs,
      use: { ...chromeUse }
    },
    {
      name: "smoke-intelligence",
      testMatch: /smoke\/04-intelligence-reporting\.spec\.ts/,
      timeout: smokeTimeoutMs,
      use: { ...chromeUse }
    },
    {
      name: "smoke-configuration",
      testMatch: /smoke\/05-configuration\.spec\.ts/,
      timeout: smokeTimeoutMs,
      use: { ...chromeUse }
    },
    {
      // Longer journeys (org isolation, connect, automation) + optional mobile overflow.
      name: "chromium",
      testMatch: /.*\.spec\.ts/,
      testIgnore: [/smoke\//, /auth\.setup\.ts/],
      timeout: 240_000,
      use: { ...chromeUse }
    }
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEB_SERVER
    ? undefined
    : {
        command: "pnpm --filter @opswatch/web start",
        url: "http://127.0.0.1:3000/login",
        reuseExistingServer: true,
        timeout: 120_000
      }
});
