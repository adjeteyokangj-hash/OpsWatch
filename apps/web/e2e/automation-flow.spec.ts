import { expect, test } from "@playwright/test";
import { apiBase, primaryEmail, primaryPassword } from "./helpers/constants";
import { loginAs, sessionCookies } from "./helpers/auth";

test.describe("automation approval browser flow", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API, web, DB, and worker running."
  );

  test("login, open incident, and render automation plan panel", async ({ page }) => {
    await loginAs(page, primaryEmail, primaryPassword);
    const cookies = await sessionCookies(page);
    expect(cookies.session).toBeTruthy();
    expect(cookies.csrf).toBeTruthy();

    const incidentsResponse = await page.request.get(`${apiBase}/incidents`, {
      headers: cookies.csrf ? { "x-opswatch-csrf": cookies.csrf } : undefined
    });
    expect(incidentsResponse.ok()).toBeTruthy();
    const incidents = (await incidentsResponse.json()) as Array<{ id: string }>;
    test.skip(incidents.length === 0, "No incidents available for browser E2E");

    const incidentId = incidents[0]!.id;
    await page.goto(`/incidents/${incidentId}`);

    await page.getByRole("button", { name: "Automation" }).click();
    await expect(page.getByRole("heading", { name: /automation plan/i })).toBeVisible({
      timeout: 30_000
    });

    // Auto-plan may already be in flight; only click when idle Generate/Regenerate is offered.
    const generateButton = page.getByRole("button", { name: /^(generate plan|regenerate plan)$/i });
    if (await generateButton.isVisible().catch(() => false)) {
      await generateButton.click();
    }

    // Wait for Planning… to settle (success, empty, or terminal error — not an infinite retry).
    await expect(page.getByRole("button", { name: /planning/i })).toHaveCount(0, {
      timeout: 60_000
    });

    // Plannable → execution mode; otherwise empty copy or a failed-plan error.
    await expect(
      page
        .getByText(/execution mode/i)
        .or(page.getByText(/no automation plan has been generated/i))
        .or(page.getByText(/failed to generate|incident or playbook not found|not found/i))
    ).toBeVisible({ timeout: 15_000 });
  });
});
