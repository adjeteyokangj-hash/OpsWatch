import { expect, test } from "@playwright/test";
import { ensureSmokeAuth } from "../helpers/auth";
import { runSmokeGroup, smokeAssertReady, smokeGoto } from "../helpers/smoke";

test.describe("smoke: intelligence and reporting", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running (PLAYWRIGHT_SKIP_WEB_SERVER=true)."
  );

  test("intelligence and reports", async ({ page }, testInfo) => {
    test.setTimeout(60_000);

    await runSmokeGroup(page, testInfo, "smoke-intelligence-reporting", async () => {
      await ensureSmokeAuth(page);

      await smokeGoto(page, "/intelligence", /\/intelligence/);
      await smokeAssertReady(page, "Intelligence", /Intelligence/i, /intelligence|learning|prediction/i);
      await expect(page.getByRole("button", { name: /logout/i })).toBeVisible();

      await expect(
        page.getByText(/disabled|not emitting|predictions are disabled|prediction readiness|not ready/i).first()
      ).toBeVisible({ timeout: 12_000 });

      await smokeGoto(page, "/reports", /\/reports/);
      await smokeAssertReady(page, "Reports", /Reports/i, /report|analytics|operations|insights|accuracy|status/i);
    });
  });
});
