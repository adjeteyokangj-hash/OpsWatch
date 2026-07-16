import { expect, test } from "@playwright/test";
import { ensureSmokeAuth } from "../helpers/auth";
import { runSmokeGroup, smokeAssertReady, smokeGoto } from "../helpers/smoke";

test.describe("smoke: configuration", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running (PLAYWRIGHT_SKIP_WEB_SERVER=true)."
  );

  test("integrations and settings", async ({ page }, testInfo) => {
    test.setTimeout(60_000);

    await runSmokeGroup(page, testInfo, "smoke-configuration", async () => {
      await ensureSmokeAuth(page);

      await smokeGoto(page, "/integrations", /\/integrations/);
      await smokeAssertReady(page, "Integrations", /Integrations/i, /integration|provider|connection|application/i);
      await expect(page.getByRole("button", { name: /logout/i })).toBeVisible();

      await smokeGoto(page, "/settings", /\/settings/);
      await smokeAssertReady(page, "Settings", /Settings/i, /setting|notification|preference/i);
    });
  });
});
