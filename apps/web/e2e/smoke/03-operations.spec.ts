import { expect, test } from "@playwright/test";
import { ensureSmokeAuth } from "../helpers/auth";
import { runSmokeGroup, smokeAssertReady, smokeGoto } from "../helpers/smoke";

test.describe("smoke: operations", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running (PLAYWRIGHT_SKIP_WEB_SERVER=true)."
  );

  test("alerts, incidents, automation", async ({ page }, testInfo) => {
    test.setTimeout(60_000);

    await runSmokeGroup(page, testInfo, "smoke-operations", async () => {
      await ensureSmokeAuth(page);

      await smokeGoto(page, "/alerts", /\/alerts/);
      await smokeAssertReady(page, "Alerts", /Alerts/i, /alert/i);
      await expect(page.getByRole("button", { name: /logout/i })).toBeVisible();

      await smokeGoto(page, "/incidents", /\/incidents/);
      await smokeAssertReady(page, "Incidents", /Incidents/i, /incident/i);

      await smokeGoto(page, "/automation", /\/automation/);
      await smokeAssertReady(page, "Automation", /Automation/i, /automation|playbook/i);
    });
  });
});
