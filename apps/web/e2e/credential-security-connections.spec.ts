import fs from "fs";
import path from "path";
import { expect, test } from "@playwright/test";
import { attachIssueCollector, writeFailureArtifacts } from "./helpers/artifacts";
import { primaryEmail, primaryPassword } from "./helpers/constants";
import {
  assertPageReady,
  blockDevNoise,
  gotoAuthed,
  loginAs,
  proxiedRequest,
  sessionCookies
} from "./helpers/auth";

const phase2ArtifactsDir = path.resolve(process.cwd(), "..", "..", "test-artifacts", "phase2");

const savePhase2Screenshot = async (page: import("@playwright/test").Page, name: string) => {
  fs.mkdirSync(phase2ArtifactsDir, { recursive: true });
  await page.screenshot({ path: path.join(phase2ArtifactsDir, `${name}.png`), fullPage: true });
};

test.describe("credential security: connections", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running."
  );

  test("save secret, reload shows configured not plaintext, rotate when allowed", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);

    try {
      await loginAs(page, primaryEmail, primaryPassword);
      expect((await sessionCookies(page)).session).toBeTruthy();

      const slug = `pw-cred-${Date.now().toString(36)}`;
      const createRes = await proxiedRequest(page, "/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        data: {
          name: `PW Credential ${slug}`,
          slug,
          clientName: "Playwright Credential",
          environment: "testing"
        },
        timeout: 60_000,
        retries: 4
      });
      expect(createRes.ok(), await createRes.text()).toBeTruthy();
      const project = (await createRes.json()) as { id: string; name: string };
      const tempSecret = `pw-temp-secret-${Date.now()}`;

      const connectionRes = await proxiedRequest(page, "/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        data: {
          projectId: project.id,
          applicationId: project.id,
          name: `${project.name} REST`,
          environment: "test",
          connectorType: "REST_API",
          mode: "API",
          type: "REST",
          baseUrl: "https://httpbin.org",
          healthPath: "/status/200",
          authType: "BEARER",
          authMethod: "BEARER",
          authSecret: tempSecret,
          authPrefix: "Bearer",
          timeoutMs: 10000
        },
        timeout: 60_000,
        retries: 2
      });
      expect(connectionRes.ok(), await connectionRes.text()).toBeTruthy();
      const created = (await connectionRes.json()) as { id: string };

      await gotoAuthed(page, "/connections");
      await assertPageReady(page, "Connections", /Connections/i);
      await expect(page.getByTestId(`connection-row-${created.id}`)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId(`connection-credential-mask-${created.id}`)).toHaveText("Configured");
      await expect(page.locator(`text=${tempSecret}`)).toHaveCount(0);

      await savePhase2Screenshot(page, "connections-configured-masked");
      await page.reload();
      await assertPageReady(page, "Connections", /Connections/i);
      await expect(page.locator(`text=${tempSecret}`)).toHaveCount(0);
      await expect(page.getByTestId(`connection-credential-mask-${created.id}`)).toHaveText("Configured");

      const rotateButton = page.getByTestId(`connection-rotate-button-${created.id}`);
      if (await rotateButton.isVisible().catch(() => false)) {
        await rotateButton.click();
        await page.getByTestId(`connection-rotate-${created.id}`).locator('input[type="password"]').fill(
          `pw-rotated-${Date.now()}`
        );
        await page.getByTestId(`connection-rotate-${created.id}`).getByRole("button", { name: "Save secret" }).click();
        await expect(page.getByTestId(`connection-credential-mask-${created.id}`)).toHaveText("Configured", {
          timeout: 30_000
        });
        await savePhase2Screenshot(page, "connections-rotated");
      }

      await proxiedRequest(page, `/connections/${created.id}`, { method: "DELETE" });
    } catch (error) {
      await writeFailureArtifacts(page, testInfo, issues, "credential-security-connections");
      throw error;
    }
  });
});
