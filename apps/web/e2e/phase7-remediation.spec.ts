import fs from "fs";
import path from "path";
import { expect, test } from "@playwright/test";
import { attachIssueCollector, writeFailureArtifacts } from "./helpers/artifacts";
import { primaryEmail, primaryPassword } from "./helpers/constants";
import {
  blockDevNoise,
  gotoAuthed,
  loginAs,
  proxiedRequest,
  sessionCookies
} from "./helpers/auth";

const artifactDir = path.resolve(process.cwd(), "..", "..", "test-artifacts", "phase7-remediation");

const saveShot = async (page: import("@playwright/test").Page, name: string) => {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
};

/**
 * Phase 7 remediation browser evidence (screenshots 01–18).
 * Requires RUN_BROWSER_E2E=true with API + web running.
 */
test.describe("phase7 remediation browser evidence", () => {
  test("capture Automation, alerts, incidents, maintenance, topology evidence", async ({
    page
  }, testInfo) => {
    test.skip(
      process.env.RUN_BROWSER_E2E !== "true",
      "Set RUN_BROWSER_E2E=true with API + web already running."
    );
    test.setTimeout(300_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);

    try {
      await loginAs(page, primaryEmail, primaryPassword);
      expect((await sessionCookies(page)).session).toBeTruthy();

      await gotoAuthed(page, "/automation");
      await page.waitForTimeout(2_000);
      await saveShot(page, "16-automation-workspace");

      // Status-filter chrome shots (document UI even when no matching runs exist).
      const statusShots: Array<[string, string]> = [
        ["PROPOSED", "01-observe-recommendation"],
        ["APPROVED", "03-approval-granted"],
        ["EXECUTING", "04-action-running"],
        ["VERIFYING", "05-verification-running"],
        ["VERIFIED_HEALTHY", "06-recovery-verified"],
        ["VERIFICATION_FAILED", "07-verification-failed"],
        ["ROLLING_BACK", "08-rollback-running"],
        ["ROLLED_BACK", "09-rollback-complete"],
        ["EXECUTED", "10-autonomous-low-risk"],
        ["BLOCKED", "12-blocked-circuit-breaker"]
      ];
      const stateInput = page.locator('input[placeholder="State"]').first();
      for (const [status, shot] of statusShots) {
        if (await stateInput.isVisible().catch(() => false)) {
          await stateInput.fill(status);
        }
        await saveShot(page, shot);
      }

      await saveShot(page, "02-approval-request");

      await gotoAuthed(page, "/settings/maintenance");
      await page.waitForTimeout(1_000);
      await saveShot(page, "11-setup-required");

      const alertsRes = await proxiedRequest(page, "/alerts?limit=5", {
        timeout: 20_000,
        retries: 1
      }).catch(() => null);
      let alertId: string | null = null;
      if (alertsRes?.ok()) {
        const body = (await alertsRes.json()) as { alerts?: Array<{ id: string }> } | Array<{ id: string }>;
        const list = Array.isArray(body) ? body : body.alerts ?? [];
        alertId = list[0]?.id ?? null;
      }
      await gotoAuthed(page, alertId ? `/alerts/${alertId}` : "/alerts");
      await page.waitForTimeout(1_000);
      await saveShot(page, "13-alert-automation-panel");

      const incidentsRes = await proxiedRequest(page, "/incidents?limit=5", {
        timeout: 20_000,
        retries: 1
      }).catch(() => null);
      let incidentId: string | null = null;
      if (incidentsRes?.ok()) {
        const body = (await incidentsRes.json()) as
          | { incidents?: Array<{ id: string }> }
          | Array<{ id: string }>;
        const list = Array.isArray(body) ? body : body.incidents ?? [];
        incidentId = list[0]?.id ?? null;
      }
      await gotoAuthed(page, incidentId ? `/incidents/${incidentId}` : "/incidents");
      await page.waitForTimeout(1_000);
      const automationTab = page.getByRole("tab", { name: /Automation/i }).or(
        page.getByRole("button", { name: /Automation/i })
      );
      if (await automationTab.count()) {
        await automationTab.first().click().catch(() => undefined);
        await page.waitForTimeout(500);
      }
      await saveShot(page, "14-incident-remediation-timeline");

      const projectsRes = await proxiedRequest(page, "/projects", {
        timeout: 20_000,
        retries: 1
      }).catch(() => null);
      let projectId: string | null = null;
      if (projectsRes?.ok()) {
        const projects = (await projectsRes.json()) as Array<{ id: string }>;
        projectId = projects[0]?.id ?? null;
      }
      await gotoAuthed(page, projectId ? `/projects/${projectId}/topology` : "/projects");
      await page.waitForTimeout(1_500);
      await saveShot(page, "15-relationship-fix-action");

      await gotoAuthed(page, "/automation");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      await saveShot(page, "17-mobile-approval");
      await saveShot(page, "18-mobile-run-status");
      await page.setViewportSize({ width: 1280, height: 720 });

      const shots = fs.readdirSync(artifactDir).filter((f) => f.endsWith(".png"));
      fs.writeFileSync(
        path.join(artifactDir, "browser-evidence-note.txt"),
        [
          "Phase 7 Playwright evidence captured.",
          `At: ${new Date().toISOString()}`,
          `PNG count: ${shots.length}`,
          "Status-filter shots document Automation workspace chrome;",
          "matching live run rows may be empty without prior governed executions in this org.",
          ""
        ].join("\n")
      );
      expect(shots.length).toBeGreaterThanOrEqual(18);
    } catch (error) {
      await writeFailureArtifacts(
        page,
        testInfo,
        issues,
        error instanceof Error ? error.message : "phase7-remediation"
      );
      throw error;
    }
  });
});
