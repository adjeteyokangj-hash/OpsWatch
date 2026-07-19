import { mkdir } from "fs/promises";
import path from "path";
import { expect, test } from "@playwright/test";
import { primaryEmail, primaryPassword } from "./helpers/constants";
import {
  blockDevNoise,
  gotoAuthed,
  loginAs,
  proxiedRequest
} from "./helpers/auth";

const evidencePath = path.resolve(
  __dirname,
  "../../../test-artifacts/phase1/url-only-onboarding-active.png"
);

test.describe("URL-only onboarding", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API, web, and worker running."
  );

  test("registers public/admin URLs and shows worker evidence without heartbeat", async ({ page }) => {
    test.setTimeout(180_000);
    await blockDevNoise(page);
    await loginAs(page, primaryEmail, primaryPassword);

    let projectId = "";
    try {
      await gotoAuthed(page, "/projects");
      await page.getByRole("button", { name: /register application/i }).click();

      const suffix = Date.now().toString(36);
      await page.getByLabel("Application name *").fill(`TEST ONLY URL onboarding ${suffix}`);
      await page.getByLabel("Environment *").selectOption("testing");
      await page.getByLabel(/Public application URL/).fill("https://example.com/");
      await page.getByLabel(/Admin URL/).fill("https://example.org/");

      const createResponsePromise = page.waitForResponse((response) =>
        response.url().includes("/api/projects") &&
        response.request().method() === "POST"
      );
      await page.getByRole("button", { name: "Register application" }).click();
      const createResponse = await createResponsePromise;
      expect(createResponse.status()).toBe(201);
      const created = await createResponse.json() as { id: string };
      projectId = created.id;

      await expect(page.getByText(/Setting up external monitoring|External monitoring is active/)).toBeVisible();
      await expect(page.getByText("Website connection created")).toBeVisible();
      await expect(page.getByText("HTTP check scheduled")).toBeVisible();
      await expect(page.getByText("SSL check scheduled")).toBeVisible();
      await expect(page.getByText("Awaiting setup")).toBeVisible();

      let monitoringStatus = "SETTING_UP";
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const projectResponse = await proxiedRequest(page, `/projects/${projectId}`);
        expect(projectResponse.ok()).toBeTruthy();
        const project = await projectResponse.json() as {
          monitoringSetup?: { status?: string };
          heartbeats?: unknown[];
        };
        monitoringStatus = String(project.monitoringSetup?.status ?? "");
        expect(project.heartbeats ?? []).toHaveLength(0);
        if (monitoringStatus === "ACTIVE") break;
        await page.waitForTimeout(2_000);
      }
      expect(monitoringStatus).toBe("ACTIVE");

      await gotoAuthed(page, `/projects/${projectId}`);
      await expect(page.getByTestId("monitoring-depth-summary")).toBeVisible();
      await expect(page.getByText("Not connected", { exact: true }).first()).toBeVisible();
      await expect(page.locator("body")).not.toContainText(/unexpected application error/i);

      await mkdir(path.dirname(evidencePath), { recursive: true });
      await page.screenshot({ path: evidencePath, fullPage: true });
    } finally {
      if (projectId) {
        await proxiedRequest(page, `/projects/${projectId}`, { method: "DELETE" });
      }
    }
  });
});
