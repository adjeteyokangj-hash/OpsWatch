import { expect, test } from "@playwright/test";

const apiBase = process.env.PLAYWRIGHT_API_URL || "http://localhost:4000/api";
const email = process.env.PLAYWRIGHT_LOGIN_EMAIL || "adjeteyokangj@gmail.com";
const password = process.env.PLAYWRIGHT_LOGIN_PASSWORD || "OpsWatch!2026#LiveAdmin";

test.describe("automation approval browser flow", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API, web, DB, and worker running."
  );

  test("login, open incident, and render automation plan panel", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard**", { timeout: 30_000 });

    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find((c) => c.name === "opswatch_session")?.value;
    const csrfCookie = cookies.find((c) => c.name === "opswatch_csrf")?.value;
    expect(sessionCookie).toBeTruthy();
    expect(csrfCookie).toBeTruthy();

    const incidentsResponse = await page.request.get(`${apiBase}/incidents`, {
      headers: csrfCookie ? { "x-opswatch-csrf": csrfCookie } : undefined
    });
    expect(incidentsResponse.ok()).toBeTruthy();
    const incidents = (await incidentsResponse.json()) as Array<{ id: string }>;
    test.skip(incidents.length === 0, "No incidents available for browser E2E");

    const incidentId = incidents[0]!.id;
    await page.goto(`/incidents/${incidentId}`);
    await expect(page.getByRole("heading", { name: /automation plan/i })).toBeVisible({
      timeout: 30_000
    });

    const generateButton = page.getByRole("button", { name: /generate plan|regenerate plan/i });
    if (await generateButton.isVisible()) {
      await generateButton.click();
    }

    await expect(page.getByText(/execution mode/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/observe only|approval/i)).toBeVisible();
  });
});
