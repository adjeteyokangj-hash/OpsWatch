import { expect, test, type Page } from "@playwright/test";

const email = process.env.PLAYWRIGHT_LOGIN_EMAIL || "admin@opswatch.local";
const password = process.env.PLAYWRIGHT_LOGIN_PASSWORD || "OpsWatch!2026#LocalDevOnly";

/** Prefer 127.0.0.1 — localhost can flap with Next/dev proxy + dual-stack. */
const base = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

const routes: Array<{ path: string; name: string; marker: RegExp }> = [
  { path: "/dashboard", name: "Dashboard", marker: /dashboard|command|operations|overview/i },
  { path: "/projects", name: "Applications", marker: /application|register|project/i },
  { path: "/incidents", name: "Incidents", marker: /incident/i },
  { path: "/alerts", name: "Alerts", marker: /alert/i },
  { path: "/automation", name: "Automation", marker: /automation|playbook/i },
  { path: "/intelligence", name: "Intelligence", marker: /intelligence|learning|prediction/i },
  { path: "/members", name: "Team", marker: /member|team|invite|platform/i },
  { path: "/settings", name: "Settings", marker: /setting/i },
  { path: "/subscription", name: "Billing", marker: /subscription|billing|plan/i }
];

const collectPageIssues = (page: Page) => {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(String(err.message || err));
  });
  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && /127\.0\.0\.1:(3000|4000)|localhost:(3000|4000)/.test(url)) {
      if (status === 401 && /\/auth\//.test(url)) return;
      if (status === 404 && /favicon/.test(url)) return;
      failedResponses.push(`${status} ${url}`);
    }
  });

  return { consoleErrors, failedResponses };
};

const gotoSafe = async (page: Page, path: string) => {
  const url = path.startsWith("http") ? path : `${base}${path}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      return;
    } catch (error) {
      if (attempt === 1) throw error;
      await page.waitForTimeout(500);
    }
  }
};

test.describe("release smoke routes", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running (PLAYWRIGHT_SKIP_WEB_SERVER=true)."
  );

  test("login and smoke upgraded workspaces", async ({ page }) => {
    test.setTimeout(110_000);
    const issues = collectPageIssues(page);
    const visited: string[] = [];

    await gotoSafe(page, "/login");
    await expect(page.getByRole("heading", { name: /sign in|command center/i }).first()).toBeVisible({
      timeout: 15_000
    });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    visited.push("Login→Dashboard");

    for (const route of routes) {
      await gotoSafe(page, route.path);
      await expect(page.locator("body")).not.toContainText(/unexpected application error/i);
      const text = await page.locator("body").innerText();
      expect(text.length, `${route.name} blank`).toBeGreaterThan(40);
      expect(text, `${route.name} missing marker`).toMatch(route.marker);
      visited.push(route.name);
    }

    // App detail + topology when a project exists
    await gotoSafe(page, "/projects");
    const appLink = page.locator('a[href*="/projects/"]').filter({ hasNotText: /^$/ }).first();
    if (await appLink.count()) {
      const href = await appLink.getAttribute("href");
      if (href && href.includes("/projects/")) {
        await gotoSafe(page, href);
        await expect(page.locator("body")).not.toContainText(/unexpected application error/i);
        visited.push("App detail");
        const topologyHref = await page.locator('a[href*="topology"]').first().getAttribute("href");
        if (topologyHref) {
          await gotoSafe(page, topologyHref);
          await expect(page.locator("body")).not.toContainText(/unexpected application error/i);
          visited.push("Topology");
        }
      }
    }

    // Connect / register surface
    await gotoSafe(page, "/projects");
    const registerCta = page.getByRole("button", { name: /register|connect|add application/i }).first();
    if (await registerCta.count()) {
      await registerCta.click();
      await expect(
        page.getByText(/register|connect|waiting for first heartbeat|credentials|slug|ingest/i).first()
      ).toBeVisible({ timeout: 12_000 });
      visited.push("Connect");
    }

    await gotoSafe(page, "/intelligence");
    await expect(
      page.getByText(/disabled|not emitting|predictions are disabled|prediction readiness|not ready/i).first()
    ).toBeVisible({ timeout: 15_000 });
    visited.push("Intelligence predictions gated");

    const criticalConsole = issues.consoleErrors.filter(
      (row) => !/favicon|Download the React DevTools|hydration/i.test(row)
    );
    const unexpectedNetwork = issues.failedResponses.filter(
      (row) => !/\/_next\/static|\/favicon/.test(row)
    );

    // eslint-disable-next-line no-console
    console.log("SMOKE_VISITED", visited.join(" → "));
    expect(criticalConsole, `console errors: ${criticalConsole.join(" | ")}`).toEqual([]);
    expect(unexpectedNetwork, `failed network: ${unexpectedNetwork.join(" | ")}`).toEqual([]);
  });

  test("mobile nav keyboard and overflow", async ({ page }) => {
    test.setTimeout(70_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoSafe(page, "/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

    const menu = page.getByRole("button", { name: /menu/i });
    await expect(menu).toBeVisible();
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#primary-navigation")).toBeVisible();

    // Keyboard: Tab to a nav link
    await page.keyboard.press("Tab");
    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? "");
    expect(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]).toContain(activeTag);

    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflowX, "mobile horizontal overflow").toBeLessThanOrEqual(12);

    // Desktop spot check after resize
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoSafe(page, "/projects");
    const deskOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(deskOverflow, "desktop horizontal overflow").toBeLessThanOrEqual(12);
  });
});
