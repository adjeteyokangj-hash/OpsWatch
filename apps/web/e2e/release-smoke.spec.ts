import { expect, test, type Page } from "@playwright/test";

const email = process.env.PLAYWRIGHT_LOGIN_EMAIL || "admin@opswatch.local";
const password = process.env.PLAYWRIGHT_LOGIN_PASSWORD || "OpsWatch!2026#LocalDevOnly";

const routes: Array<{ path: string; heading?: RegExp; name: string }> = [
  { path: "/dashboard", name: "Dashboard", heading: /dashboard|command|operations/i },
  { path: "/projects", name: "Applications", heading: /application/i },
  { path: "/incidents", name: "Incidents", heading: /incident/i },
  { path: "/alerts", name: "Alerts", heading: /alert/i },
  { path: "/automation", name: "Automation", heading: /automation/i },
  { path: "/intelligence", name: "Intelligence", heading: /intelligence|learning|prediction/i },
  { path: "/members", name: "Team", heading: /member|team|platform/i },
  { path: "/settings", name: "Settings", heading: /setting/i },
  { path: "/subscription", name: "Billing", heading: /subscription|billing|plan/i }
];

const collectPageIssues = async (page: Page) => {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && /localhost:(3000|4000)|127\.0\.0\.1:(3000|4000)/.test(url)) {
      // Ignore expected auth redirects noise
      if (status === 401 && url.includes("/auth/")) return;
      failedResponses.push(`${status} ${url}`);
    }
  });

  return { consoleErrors, failedResponses };
};

test.describe("release smoke routes", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running (PLAYWRIGHT_SKIP_WEB_SERVER=true)."
  );

  test("login and smoke upgraded workspaces", async ({ page }) => {
    const issues = await collectPageIssues(page);

    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in|command center/i }).first()).toBeVisible();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard**", { timeout: 45_000 });

    for (const route of routes) {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).not.toContainText(/unexpected application error/i);
      if (route.heading) {
        await expect(page.getByRole("heading").filter({ hasText: route.heading }).first()).toBeVisible({
          timeout: 30_000
        });
      }
      // Prefer an honest loading/empty/error state over a blank crash
      const bodyText = await page.locator("main, .content, body").first().innerText();
      expect(bodyText.length).toBeGreaterThan(20);
    }

    // Deep-link: first application detail + topology when available
    await page.goto("/projects");
    const appLink = page.locator('a[href*="/projects/"]').first();
    if (await appLink.count()) {
      const href = await appLink.getAttribute("href");
      if (href) {
        await page.goto(href);
        await expect(page.locator("body")).not.toContainText(/unexpected application error/i);
        const topologyLink = page.locator('a[href*="/topology"]').first();
        if (await topologyLink.count()) {
          await topologyLink.click();
          await expect(page.locator("body")).not.toContainText(/unexpected application error/i);
        }
      }
    }

    // Registration / Connect surface
    await page.goto("/projects");
    const registerCta = page.getByRole("button", { name: /register|connect|add application/i }).first();
    if (await registerCta.count()) {
      await registerCta.click();
      await expect(
        page.getByText(/register|connect|waiting for first heartbeat|credentials|slug/i).first()
      ).toBeVisible({ timeout: 15_000 });
    }

    // Intelligence predictions must stay gated
    await page.goto("/intelligence");
    await expect(page.getByText(/disabled|not emitting|predictions are disabled|prediction readiness/i).first()).toBeVisible({
      timeout: 30_000
    });

    const criticalConsole = issues.consoleErrors.filter(
      (row) => !/favicon|Download the React DevTools/i.test(row)
    );
    const unexpectedNetwork = issues.failedResponses.filter((row) => !/\/_next\/static/.test(row));

    expect(criticalConsole, `console errors: ${criticalConsole.join(" | ")}`).toEqual([]);
    expect(unexpectedNetwork, `failed network: ${unexpectedNetwork.join(" | ")}`).toEqual([]);
  });

  test("mobile nav and keyboard focus on dashboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard**", { timeout: 45_000 });

    const menu = page.getByRole("button", { name: /menu/i });
    await expect(menu).toBeVisible();
    await menu.click();
    await expect(page.locator("#primary-navigation")).toBeVisible();

    // Keyboard: Tab should move focus into interactive content
    await page.keyboard.press("Tab");
    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]).toContain(activeTag);

    // No horizontal document overflow at mobile width
    const overflowX = await page.evaluate(() => {
      const doc = document.documentElement;
      return doc.scrollWidth - doc.clientWidth;
    });
    expect(overflowX).toBeLessThanOrEqual(8);
  });
});
