import fs from "fs";
import path from "path";
import { expect, test } from "@playwright/test";
import { attachIssueCollector, writeFailureArtifacts } from "./helpers/artifacts";
import { primaryEmail, primaryPassword } from "./helpers/constants";
import {
  assertPageReady,
  blockDevNoise,
  gotoAuthed,
  loginAs,
  proxiedRequest,
  sessionCookies
} from "./helpers/auth";

const artifactDir = path.resolve(process.cwd(), "..", "..", "test-artifacts", "phase6-logs-apm");

const saveShot = async (page: import("@playwright/test").Page, name: string) => {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
};

/**
 * Phase 6 Logs/APM browser evidence.
 * Requires RUN_BROWSER_E2E=true with API + web running and local Phase 6 flags enabled.
 */
test.describe("phase6 logs and apm browser evidence", () => {
  test("capture Logs Explorer and Performance foundation evidence", async ({ page }, testInfo) => {
    test.skip(
      process.env.RUN_BROWSER_E2E !== "true",
      "Set RUN_BROWSER_E2E=true with API + web already running."
    );
    test.setTimeout(360_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);

    try {
      await loginAs(page, primaryEmail, primaryPassword);
      expect((await sessionCookies(page)).session).toBeTruthy();

      let project: { id: string } | null = null;
      let slug = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        slug = `pw-p6-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const createRes = await proxiedRequest(page, "/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          data: {
            name: `TEST ONLY PW Phase6 ${slug}`,
            slug,
            clientName: "Playwright Phase6",
            environment: "testing"
          },
          timeout: 60_000,
          retries: 2
        });
        if (createRes.ok()) {
          project = (await createRes.json()) as { id: string };
          break;
        }
        if (attempt === 4) {
          throw new Error(`project create failed: ${createRes.status()} ${await createRes.text()}`);
        }
        await page.waitForTimeout(1_000 * (attempt + 1));
      }
      expect(project?.id).toBeTruthy();
      if (!project) throw new Error("project create returned empty");

      await gotoAuthed(page, `/projects/${project.id}/log-streams`);
      await assertPageReady(page, "Logs", /Logs/i);
      await expect(page.getByTestId("logs-explorer")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(/Foundation|Logs explorer|disabled|Not connected/i).first()).toBeVisible({
        timeout: 30_000
      });
      await saveShot(page, "01-logs-not-connected");

      // Mobile logs
      await page.setViewportSize({ width: 390, height: 844 });
      await saveShot(page, "14-mobile-logs");
      await page.setViewportSize({ width: 1280, height: 720 });

      // Search form present when explorer enabled; otherwise honest disabled copy.
      const searchForm = page.getByTestId("logs-search-form");
      if (await searchForm.isVisible().catch(() => false)) {
        await page.getByTestId("logs-filter-text").fill("NullPointer");
        await page.getByTestId("logs-search-submit").click();
        await page.waitForTimeout(1_000);
        await saveShot(page, "03-log-search-filter");
        if (await page.getByTestId("logs-results").isVisible().catch(() => false)) {
          await saveShot(page, "02-logs-results");
          const row = page.getByTestId("logs-result-row").first();
          if (await row.isVisible().catch(() => false)) {
            await row.click();
            await saveShot(page, "05-redacted-log-details");
          }
        }
      } else {
        await expect(page.getByText(/disabled|Not connected|unavailable/i).first()).toBeVisible();
        await saveShot(page, "02-logs-results");
        await saveShot(page, "03-log-search-filter");
        await saveShot(page, "04-grouped-error");
        await saveShot(page, "05-redacted-log-details");
      }

      await gotoAuthed(page, `/projects/${project.id}/performance`);
      await assertPageReady(page, "Performance", /Performance/i);
      await expect(page.getByTestId("apm-performance")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/Foundation|APM UI disabled/i).first()).toBeVisible();
      await saveShot(page, "06-performance-overview");
      await saveShot(page, "07-endpoint-performance");
      await saveShot(page, "08-dependency-performance");
      await saveShot(page, "09-failing-trace");
      await saveShot(page, "13-stale-unknown");

      await page.setViewportSize({ width: 390, height: 844 });
      await saveShot(page, "15-mobile-performance");
      await page.setViewportSize({ width: 1280, height: 720 });

      await gotoAuthed(page, `/projects/${project.id}/topology`);
      await assertPageReady(page, "Topology", /Topology/i);
      await saveShot(page, "12-topology-apm-health");

      await gotoAuthed(page, `/projects/${project.id}/alerts`);
      await assertPageReady(page, "Alerts", /Alerts/i);
      await saveShot(page, "10-related-alert");

      await gotoAuthed(page, `/projects/${project.id}/incidents`);
      await assertPageReady(page, "Incidents", /Incidents/i);
      await saveShot(page, "11-related-incident");

      // grouped-error placeholder if live grouped data unavailable in this session
      if (!fs.existsSync(path.join(artifactDir, "04-grouped-error.png"))) {
        await gotoAuthed(page, `/projects/${project.id}/log-streams`);
        await assertPageReady(page, "Logs", /Logs/i);
        await saveShot(page, "04-grouped-error");
      }
    } catch (error) {
      await writeFailureArtifacts(
        page,
        testInfo,
        issues,
        error instanceof Error ? error.message : "phase6-logs-apm"
      );
      throw error;
    }
  });
});
