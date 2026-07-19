import { expect, test } from "@playwright/test";

/**
 * Phase 6 Logs/APM UI smoke — requires authenticated session fixture used by other e2e specs.
 * Captures honest Foundation / disabled / empty states; does not invent live Noble telemetry.
 */
test.describe("Phase 6 Logs and APM UI", () => {
  test.skip(!process.env.E2E_PROJECT_ID, "E2E_PROJECT_ID required");

  test("Logs explorer shows Foundation state", async ({ page }) => {
    const projectId = process.env.E2E_PROJECT_ID!;
    await page.goto(`/projects/${projectId}/log-streams`);
    await expect(page.getByTestId("logs-explorer")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Foundation/i).first()).toBeVisible();
    await page.screenshot({
      path: "test-artifacts/phase6-logs-apm/logs-foundation.png",
      fullPage: true
    });
  });

  test("Performance page shows Foundation or disabled state", async ({ page }) => {
    const projectId = process.env.E2E_PROJECT_ID!;
    await page.goto(`/projects/${projectId}/performance`);
    await expect(page.getByTestId("apm-performance")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Foundation|APM UI disabled/i).first()).toBeVisible();
    await page.screenshot({
      path: "test-artifacts/phase6-logs-apm/performance-foundation.png",
      fullPage: true
    });
  });
});
