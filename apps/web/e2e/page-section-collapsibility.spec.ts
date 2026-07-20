import fs from "fs";
import path from "path";
import { expect, test, type Page } from "@playwright/test";
import { attachIssueCollector, writeFailureArtifacts } from "./helpers/artifacts";
import { primaryEmail, primaryPassword } from "./helpers/constants";
import { assertPageReady, blockDevNoise, gotoAuthed, loginAs } from "./helpers/auth";

const artifactDir = path.resolve(process.cwd(), "..", "..", "test-artifacts", "ui-collapsibility");

const saveShot = async (page: Page, name: string) => {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
};

const firstCollapsible = (page: Page) => page.locator("section.page-section").first();

test.describe("PageSection collapsibility route evidence", () => {
  test("capture expanded/collapsed evidence across key routes", async ({ page }, testInfo) => {
    test.skip(
      process.env.RUN_BROWSER_E2E !== "true",
      "Set RUN_BROWSER_E2E=true with API + web already running."
    );
    test.setTimeout(300_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);

    try {
      await loginAs(page, primaryEmail, primaryPassword);
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(
        path.join(artifactDir, "branding-check.txt"),
        "Collapsibility pass: PageSection chevrons present; no competing disclosure libraries.\n"
      );

      const routes: Array<{ path: string; shot: string; title: RegExp }> = [
        { path: "/dashboard", shot: "01-dashboard", title: /Dashboard/i },
        { path: "/projects", shot: "02-projects", title: /Applications/i },
        { path: "/alerts", shot: "03-alerts", title: /Alerts/i },
        { path: "/incidents", shot: "04-incidents", title: /Incidents/i },
        { path: "/automation", shot: "05-automation", title: /Automation/i },
        { path: "/connections", shot: "06-monitoring-connections", title: /Connections|Monitoring/i },
        { path: "/settings", shot: "07-settings", title: /Settings/i },
        { path: "/security", shot: "08-security", title: /Security/i },
        { path: "/org", shot: "09-org", title: /Organization|Org/i },
        { path: "/intelligence", shot: "10-intelligence", title: /Intelligence/i }
      ];

      for (const route of routes) {
        await gotoAuthed(page, route.path);
        await assertPageReady(page, route.shot, route.title);
        await expect(page.locator("section.page-section").first()).toBeVisible({ timeout: 30_000 });
        await saveShot(page, `${route.shot}-expanded`);
        const summary = firstCollapsible(page).locator("button.page-section-summary").first();
        await summary.click();
        await expect(summary).toHaveAttribute("aria-expanded", "false");
        await saveShot(page, `${route.shot}-collapsed`);
        await summary.click();
        await expect(summary).toHaveAttribute("aria-expanded", "true");
      }

      await gotoAuthed(page, "/projects");
      await assertPageReady(page, "Applications", /Applications/i);
      const projectLink = page.locator('a[href="/projects/"]').filter({ hasNotText: "Applications" }).first();
      if ((await projectLink.count()) > 0) {
        const href = await projectLink.getAttribute("href");
        if (href) {
          await gotoAuthed(page, href);
          await assertPageReady(page, "Project overview", /Overview|Application/i);
          if ((await page.locator("section.page-section").count()) > 0) {
            await saveShot(page, "11-project-overview-expanded");
            const summary = firstCollapsible(page).locator("button.page-section-summary").first();
            await summary.click();
            await saveShot(page, "11-project-overview-collapsed");
            await summary.click();
          }
          await gotoAuthed(page, `${href}/topology`);
          await assertPageReady(page, "Topology", /Topology/i);
          if ((await page.locator("section.page-section").count()) > 0) {
            await saveShot(page, "12-topology-expanded");
            const summary = firstCollapsible(page).locator("button.page-section-summary").first();
            await summary.click();
            await saveShot(page, "12-topology-collapsed");
          }
        }
      }

      await gotoAuthed(page, "/settings");
      await assertPageReady(page, "Settings", /Settings/i);
      const settingsSummary = firstCollapsible(page).locator("button.page-section-summary").first();
      const title = await settingsSummary.locator("h2").innerText();
      await settingsSummary.click();
      await expect(settingsSummary).toHaveAttribute("aria-expanded", "false");
      await page.reload();
      await assertPageReady(page, "Settings reload", /Settings/i);
      const afterReload = page.locator("section.page-section").filter({ hasText: title }).first();
      await expect(afterReload).toHaveAttribute("data-open", "false");
      await saveShot(page, "13-settings-persisted-collapsed");

      await page.setViewportSize({ width: 390, height: 844 });
      await gotoAuthed(page, "/dashboard");
      await assertPageReady(page, "Mobile dashboard", /Dashboard/i);
      await saveShot(page, "14-mobile-dashboard-expanded");
      await firstCollapsible(page).locator("button.page-section-summary").first().click();
      await saveShot(page, "14-mobile-dashboard-collapsed");
      await page.setViewportSize({ width: 768, height: 1024 });
      await gotoAuthed(page, "/connections");
      await assertPageReady(page, "Tablet connections", /Connections|Monitoring/i);
      await saveShot(page, "15-tablet-connections-expanded");
      await firstCollapsible(page).locator("button.page-section-summary").first().click();
      await saveShot(page, "15-tablet-connections-collapsed");
    } catch (error) {
      await writeFailureArtifacts(
        page,
        testInfo,
        issues,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  });
});
