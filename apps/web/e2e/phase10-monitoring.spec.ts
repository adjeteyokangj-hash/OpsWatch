import fs from "fs";
import http from "http";
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

const artifactDir = path.resolve(process.cwd(), "..", "..", "test-artifacts", "phase10-monitoring");

const saveShot = async (page: import("@playwright/test").Page, name: string) => {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
};

test.describe("phase10 monitoring connector browser evidence", () => {
  test("capture connect monitoring source wizard, sync, and registry evidence", async ({
    page
  }, testInfo) => {
    test.skip(
      process.env.RUN_BROWSER_E2E !== "true",
      "Set RUN_BROWSER_E2E=true with API + web already running."
    );
    test.setTimeout(240_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);

    let fixtureServer: http.Server | null = null;
    let fixturePort = 0;
    let failSync = false;
    let createdId: string | null = null;

    try {
      fixtureServer = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (url.pathname.endsWith("/api/v1/validate")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, status: "ok" }));
          return;
        }
        if (url.pathname.endsWith("/api/v1/sync/metrics-alerts")) {
          if (failSync) {
            res.writeHead(503, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "upstream" }));
            return;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              monitors: [{ id: 11, name: "Browser monitor", overall_state: "OK" }],
              events: [
                {
                  id: 21,
                  title: "Latency warning",
                  alert_type: "warning",
                  monitor_id: 11,
                  date_happened: Math.floor(Date.now() / 1000)
                }
              ]
            })
          );
          return;
        }
        res.writeHead(404).end();
      });
      await new Promise<void>((resolve) => {
        fixtureServer!.listen(0, "127.0.0.1", () => {
          const addr = fixtureServer!.address();
          fixturePort = typeof addr === "object" && addr ? addr.port : 0;
          resolve();
        });
      });

      await loginAs(page, primaryEmail, primaryPassword);
      expect((await sessionCookies(page)).session).toBeTruthy();

      const projectsRes = await proxiedRequest(page, "/projects", { method: "GET" });
      expect(projectsRes.ok(), await projectsRes.text()).toBeTruthy();
      const projects = (await projectsRes.json()) as Array<{ id: string; name: string }>;
      expect(projects.length).toBeGreaterThan(0);
      const project = projects[0]!;
      const connectionName = `Phase10 Metrics ${Date.now()}`;

      // Wizard evidence (UI)
      await gotoAuthed(page, `/connections?projectId=${project.id}`);
      await assertPageReady(page, "Monitoring connections", /Monitoring connections|Connections/i);
      await expect(page.getByTestId("connection-step-details")).toBeVisible({ timeout: 30_000 });
      await saveShot(page, "01-registry-before");
      await saveShot(page, "02-wizard-details");

      await expect(page.getByTestId("connection-application")).toHaveValue(project.id, {
        timeout: 20_000
      });
      await page.getByTestId("connection-name").fill(connectionName);
      await page.getByTestId("connection-method").selectOption("METRICS_ALERTS");
      await expect(page.getByTestId("connection-catalogue-status")).toContainText(/Available/i);
      await page.getByRole("button", { name: "Continue" }).click();

      await expect(page.getByTestId("connection-step-configuration")).toBeVisible();
      await page.getByTestId("connection-base-url").fill(`http://127.0.0.1:${fixturePort}`);
      await page.getByTestId("connection-health-path").fill("/api/v1/validate");
      await page.getByTestId("connection-auth-type").selectOption("API_KEY");
      await page.getByTestId("connection-auth-secret").fill("browser-fixture-secret");
      await page.getByTestId("connection-header-name").fill("X-API-Key");
      const syncPath = page.getByTestId("connection-sync-path");
      if (await syncPath.count()) {
        await syncPath.fill("/api/v1/sync/metrics-alerts");
      }
      await saveShot(page, "03-wizard-configuration");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByTestId("connection-step-test-save")).toBeVisible();
      await saveShot(page, "04-connection-test");

      // Runtime evidence via API (same fixture), so port/mode cannot drift from UI form state.
      const createRes = await proxiedRequest(page, "/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        data: {
          applicationId: project.id,
          projectId: project.id,
          name: connectionName,
          environment: "production",
          connectorType: "METRICS_ALERTS",
          mode: "METRICS_ALERTS_CONNECTOR",
          type: "Metrics & alerts connector",
          baseUrl: `http://127.0.0.1:${fixturePort}`,
          healthPath: "/api/v1/validate",
          syncPath: "/api/v1/sync/metrics-alerts",
          authType: "API_KEY",
          authMethod: "API_KEY",
          authSecret: "browser-fixture-secret",
          authHeaderName: "X-API-Key",
          timeoutMs: 10_000,
          capabilities: ["monitoring_sync"]
        }
      });
      expect(createRes.ok(), await createRes.text()).toBeTruthy();
      const created = (await createRes.json()) as { id: string; mode: string };
      createdId = created.id;
      expect(created.mode).toBe("METRICS_ALERTS_CONNECTOR");

      const testRes = await proxiedRequest(page, `/connections/${created.id}/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        data: {}
      });
      expect(testRes.ok(), await testRes.text()).toBeTruthy();

      await gotoAuthed(page, "/connections");
      await expect(page.getByTestId(`connection-row-${created.id}`)).toBeVisible({ timeout: 30_000 });
      await saveShot(page, "05-registry-after-save");

      const syncOkRes = await proxiedRequest(page, `/connections/${created.id}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        data: {},
        retries: 2
      });
      const syncOkBody = await syncOkRes.text();
      expect([200, 422].includes(syncOkRes.status()), syncOkBody).toBeTruthy();
      const syncOk = JSON.parse(syncOkBody) as { status: string };
      expect(["SUCCEEDED", "PARTIAL"].includes(syncOk.status), syncOkBody).toBe(true);

      await page.reload();
      await assertPageReady(page, "Monitoring connections", /Monitoring connections|Connections/i);
      await expect(page.getByTestId(`connection-last-sync-${created.id}`)).toContainText(
        /SUCCEEDED|PARTIAL/i,
        { timeout: 20_000 }
      );
      await saveShot(page, "06-manual-sync-success");

      failSync = true;
      const syncFailRes = await proxiedRequest(page, `/connections/${created.id}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        data: {},
        retries: 1
      });
      const syncFailBody = await syncFailRes.text();
      expect([200, 422].includes(syncFailRes.status()), syncFailBody).toBeTruthy();
      const syncFail = JSON.parse(syncFailBody) as { status: string };
      expect(syncFail.status).toBe("FAILED");

      await page.reload();
      await assertPageReady(page, "Monitoring connections", /Monitoring connections|Connections/i);
      await expect(page.getByTestId(`connection-last-sync-${created.id}`)).toContainText(/FAILED/i, {
        timeout: 20_000
      });
      await saveShot(page, "07-manual-sync-failed");

      await gotoAuthed(page, `/projects/${project.id}/topology`);
      await page.waitForTimeout(2_000);
      await saveShot(page, "08-imported-topology-signals");

      const body = await page.locator("body").innerText();
      expect(body).not.toMatch(/datadog|dynatrace/i);
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(
        path.join(artifactDir, "branding-check.txt"),
        "No Datadog or Dynatrace branding found in captured connections/topology UI text.\n",
        "utf8"
      );

      await proxiedRequest(page, `/connections/${created.id}`, { method: "DELETE" }).catch(() => undefined);
    } catch (error) {
      await writeFailureArtifacts(
        page,
        testInfo,
        issues,
        error instanceof Error ? error.message : String(error)
      );
      if (createdId) {
        await proxiedRequest(page, `/connections/${createdId}`, { method: "DELETE" }).catch(
          () => undefined
        );
      }
      throw error;
    } finally {
      if (fixtureServer) {
        await new Promise<void>((resolve) => fixtureServer!.close(() => resolve()));
      }
    }
  });
});
