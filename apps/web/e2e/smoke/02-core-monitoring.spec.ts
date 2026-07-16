import { expect, test } from "@playwright/test";
import { ensureSmokeAuth, gotoSafe } from "../helpers/auth";
import { runSmokeGroup, smokeAssertReady, smokeGoto } from "../helpers/smoke";

test.describe("smoke: core monitoring", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running (PLAYWRIGHT_SKIP_WEB_SERVER=true)."
  );

  test("dashboard, applications, topology", async ({ page }, testInfo) => {
    test.setTimeout(60_000);

    await runSmokeGroup(page, testInfo, "smoke-core-monitoring", async () => {
      await ensureSmokeAuth(page);

      await smokeGoto(page, "/dashboard", /\/dashboard/);
      await smokeAssertReady(page, "Dashboard", /Dashboard/i, /health|operations|alert|incident|application/i);
      await expect(page.getByRole("button", { name: /logout/i })).toBeVisible();

      await smokeGoto(page, "/projects", /\/projects/);
      await smokeAssertReady(page, "Applications", /Applications/i, /application|register|project/i);

      // Default portfolio filter hides test fixtures — reveal them when the list is empty.
      const showTests = page.getByRole("button", { name: /show \d+ test application/i });
      if (await showTests.count()) {
        await showTests.first().click();
        await page.waitForTimeout(400);
      } else {
        const testFilter = page.locator("select").filter({ has: page.locator("option", { hasText: /test fixture/i }) });
        if (await testFilter.count()) {
          await testFilter.first().selectOption("all");
          await page.waitForTimeout(400);
        }
      }

      const appLink = page.locator('a[href*="/projects/"]').filter({ hasNotText: /^$/ }).first();
      if (!(await appLink.count())) {
        // eslint-disable-next-line no-console
        console.log("SMOKE_NOTE core-monitoring: no application link — topology skipped");
        return;
      }

      const href = await appLink.getAttribute("href");
      expect(href, "application detail href").toBeTruthy();
      if (!href || !/\/projects\/[^/?]+/.test(href)) {
        throw new Error(`unexpected application href: ${href}`);
      }

      await gotoSafe(page, href, 20_000);
      await expect(page.locator("body")).not.toContainText(/unexpected application error/i);
      await expect(page.locator("body")).not.toContainText(/^Project not found\.?$/i);
      await expect(page.locator("body")).not.toContainText(/Loading project context/i, { timeout: 30_000 });
      const detailText = await page.locator("body").innerText();
      expect(detailText.length).toBeGreaterThan(40);
      expect(detailText).toMatch(/overview|module|topology|incident|configuration|health|application|core operations/i);

      const topologyTab = page.locator('a[href*="topology"]').first();
      if (!(await topologyTab.count())) {
        // eslint-disable-next-line no-console
        console.log("SMOKE_NOTE core-monitoring: topology tab missing");
        return;
      }
      const topologyHref = await topologyTab.getAttribute("href");
      expect(topologyHref, "topology href").toBeTruthy();
      if (!topologyHref) return;

      await gotoSafe(page, topologyHref, 20_000);
      await expect(page.locator("body")).not.toContainText(/unexpected application error/i);
      const topo = await page.locator("body").innerText();
      expect(topo).toMatch(/topology|node|service|layer|empty|graph|health|feed/i);
    });
  });
});
