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
    test.setTimeout(240_000);
    await blockDevNoise(page);
    await loginAs(page, primaryEmail, primaryPassword);

    let projectId = "";
    try {
      const suffix = Date.now().toString(36);
      const createResponse = await proxiedRequest(page, "/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        data: {
          name: `TEST ONLY URL onboarding ${suffix}`,
          clientName: "TEST ONLY",
          environment: "testing",
          frontendUrl: "https://example.com/",
          adminUrl: "https://example.org/",
          monitoringEnabled: true,
          automationMode: "MONITOR_ONLY"
        },
        timeout: 60_000,
        retries: 4
      });
      expect(createResponse.ok(), `create ${createResponse.status()} ${await createResponse.text()}`).toBeTruthy();
      const created = (await createResponse.json()) as {
        id: string;
        monitoringSetup?: { status?: string; steps?: Record<string, boolean> };
        ingestCredentials?: { apiKey?: string; signingSecret?: string };
        heartbeats?: unknown[];
      };
      projectId = created.id;
      expect(projectId).toBeTruthy();
      expect(created.heartbeats ?? []).toHaveLength(0);
      expect(created.ingestCredentials?.apiKey).toBeTruthy();
      expect(created.ingestCredentials?.signingSecret).toBeTruthy();
      expect(created.monitoringSetup?.steps?.websiteConnectionCreated).toBe(true);
      expect(created.monitoringSetup?.steps?.httpCheckScheduled).toBe(true);
      expect(created.monitoringSetup?.steps?.sslCheckScheduled).toBe(true);

      const connectionsResponse = await proxiedRequest(page, `/connections?projectId=${projectId}`);
      expect(connectionsResponse.ok()).toBeTruthy();
      const connections = (await connectionsResponse.json()) as Array<{ name: string }>;
      expect(connections.map((row) => row.name).sort()).toEqual(["Admin endpoint", "Public website"]);

      let monitoringStatus = String(created.monitoringSetup?.status ?? "SETTING_UP");
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const projectResponse = await proxiedRequest(page, `/projects/${projectId}`);
        expect(projectResponse.ok()).toBeTruthy();
        const project = (await projectResponse.json()) as {
          monitoringSetup?: { status?: string; depth?: { applicationMonitoring?: { heartbeat?: string } } };
          heartbeats?: unknown[];
        };
        monitoringStatus = String(project.monitoringSetup?.status ?? "");
        expect(project.heartbeats ?? []).toHaveLength(0);
        expect(project.monitoringSetup?.depth?.applicationMonitoring?.heartbeat).toBe("AWAITING_SETUP");
        if (monitoringStatus === "ACTIVE") break;
        await page.waitForTimeout(2_000);
      }
      expect(monitoringStatus, "worker should produce check results for generated URL checks").toBe("ACTIVE");

      await gotoAuthed(page, `/projects/${projectId}`, new RegExp(`/projects/${projectId}`));
      await expect(page.getByTestId("monitoring-depth-summary")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText("Not connected", { exact: true }).first()).toBeVisible();
      await expect(page.getByText(/Awaiting setup|Heartbeat/i).first()).toBeVisible();
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
