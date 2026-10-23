import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e", testMatch: "issue19-catalogue.spec.ts", workers: 1, retries: 0, timeout: 120_000,
  reporter: "list", outputDir: "../../test-artifacts/issue19-browser",
  use: { baseURL: "http://127.0.0.1:3109", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" } },
    { name: "mobile", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium", channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" } }
  ]
});
