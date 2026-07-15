import { expect, test } from "@playwright/test";
import { isIgnorableConsole } from "./helpers/constants";
import { blockDevNoise, gotoSafe, loginAs } from "./helpers/auth";
import { attachIssueCollector, writeFailureArtifacts } from "./helpers/artifacts";

/**
 * Optional residual checks outside the split workspace smoke groups
 * (see e2e/smoke/*.spec.ts + auth.setup.ts).
 */
test.describe("release smoke extras", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running (PLAYWRIGHT_SKIP_WEB_SERVER=true)."
  );

  test("mobile nav keyboard and overflow", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await loginAs(page);

      // Authenticated metrics must leave loading gates on mobile viewports.
      await expect(page.getByTestId("page-heading")).toHaveText(/Dashboard/i, { timeout: 20_000 });
      await expect(page.locator("body")).not.toContainText(/Loading workspace/i, { timeout: 15_000 });
      await expect(page.getByTestId("dashboard-loading")).toHaveCount(0, { timeout: 35_000 });
      const firstMetric = page.locator(".dashboard-metrics .stat-card .value").first();
      await expect(firstMetric).toBeVisible({ timeout: 15_000 });
      await expect(firstMetric).not.toHaveText("-");

      const menu = page.getByRole("button", { name: /menu/i });
      await expect(menu).toBeVisible();
      await menu.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#primary-navigation")).toBeVisible();
      await page.keyboard.press("Tab");
      const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? "");
      expect(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]).toContain(activeTag);
      const overflowX = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflowX, "mobile horizontal overflow").toBeLessThanOrEqual(12);

      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoSafe(page, "/projects");
      const deskOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(deskOverflow, "desktop horizontal overflow").toBeLessThanOrEqual(12);

      const criticalConsole = issues.consoleErrors
        .concat(issues.pageErrors)
        .filter((row) => !isIgnorableConsole(row));
      expect(criticalConsole, `console/page errors: ${criticalConsole.join(" | ")}`).toEqual([]);
    } catch (error) {
      await writeFailureArtifacts(page, testInfo, issues, "mobile-nav");
      throw error;
    }
  });
});
