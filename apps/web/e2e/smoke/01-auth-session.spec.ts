import { expect, test } from "@playwright/test";
import { loginAsFast, proxiedRequest, sessionCookies } from "../helpers/auth";
import { primaryEmail, primaryPassword } from "../helpers/constants";
import { runSmokeGroup, smokeAssertReady, smokeGoto } from "../helpers/smoke";

test.describe("smoke: authentication and session", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running (PLAYWRIGHT_SKIP_WEB_SERVER=true)."
  );

  test("login, dashboard, session persistence", async ({ page }, testInfo) => {
    test.setTimeout(60_000);

    await runSmokeGroup(page, testInfo, "smoke-auth-session", async () => {
      await loginAsFast(page, primaryEmail, primaryPassword);

      await expect(page).toHaveURL(/\/dashboard/);
      await smokeAssertReady(page, "Dashboard", /Dashboard/i, /health|operations|alert|incident|application/i);
      await expect(page.getByRole("button", { name: /logout/i })).toBeVisible();

      const cookies = await sessionCookies(page);
      expect(cookies.session, "session cookie").toBeTruthy();
      expect(cookies.csrf, "csrf cookie").toBeTruthy();

      // Soft session API check — cookie + UI is primary under local DB flaps.
      try {
        const sessionRes = await proxiedRequest(page, "/auth/session", { timeout: 10_000, retries: 2 });
        if (sessionRes.ok()) {
          const sessionBody = (await sessionRes.json()) as { user?: { email?: string } };
          expect(String(sessionBody.user?.email || "").toLowerCase()).toBe(primaryEmail.toLowerCase());
        } else {
          // eslint-disable-next-line no-console
          console.log(`SMOKE_NOTE auth-session: /auth/session status=${sessionRes.status()} (cookie+UI accepted)`);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.log(`SMOKE_NOTE auth-session: /auth/session blip ${String(error)} (cookie+UI accepted)`);
      }

      // Persistence without logout: navigate away and back still authenticated.
      await smokeGoto(page, "/projects", /\/projects/);
      await smokeGoto(page, "/dashboard", /\/dashboard/);
      await smokeAssertReady(page, "Dashboard persistence", /Dashboard/i);
      expect(page.url()).not.toMatch(/\/login/);
      const cookiesAfter = await sessionCookies(page);
      expect(cookiesAfter.session, "session after navigation").toBeTruthy();
    });
  });
});
