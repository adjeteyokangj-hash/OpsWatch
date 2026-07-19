import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { expect, test } from "@playwright/test";
import { attachIssueCollector, writeFailureArtifacts } from "./helpers/artifacts";
import { primaryEmail, primaryPassword } from "./helpers/constants";
import {
  assertNotStuckLoading,
  assertPageReady,
  blockDevNoise,
  gotoAuthed,
  loginAs,
  proxiedRequest,
  sessionCookies
} from "./helpers/auth";

const phase3BrowserDir = path.resolve(process.cwd(), "..", "..", "test-artifacts", "phase3-browser");

const saveShot = async (page: import("@playwright/test").Page, name: string) => {
  fs.mkdirSync(phase3BrowserDir, { recursive: true });
  await page.screenshot({ path: path.join(phase3BrowserDir, `${name}.png`), fullPage: true });
};

const otelSecret = `pw-otel-secret-${Date.now()}`;

test.describe("otel phase3 browser evidence", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running."
  );

  test("ingest fixture journey and capture OTEL evidence surfaces", async ({ page }, testInfo) => {
    test.setTimeout(360_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);

    try {
      await loginAs(page, primaryEmail, primaryPassword);
      expect((await sessionCookies(page)).session).toBeTruthy();

      let project: { id: string } | null = null;
      let slug = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        slug = `pw-otel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const createRes = await proxiedRequest(page, "/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          data: {
            name: `TEST ONLY PW OTEL ${slug}`,
            slug,
            clientName: "Playwright OTEL",
            environment: "testing"
          },
          timeout: 60_000,
          retries: 2
        });
        if (createRes.ok()) {
          project = (await createRes.json()) as { id: string };
          break;
        }
        const body = await createRes.text();
        if (attempt === 4) {
          throw new Error(`project create failed: ${createRes.status()} ${body}`);
        }
        await page.waitForTimeout(1_000 * (attempt + 1));
      }
      expect(project?.id).toBeTruthy();
      if (!project) throw new Error("project create returned empty");

      const serviceRes = await proxiedRequest(page, `/projects/${project.id}/services`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        data: { name: "document-api", type: "API", status: "HEALTHY" },
        timeout: 60_000,
        retries: 3
      });
      // Some installs use /services with projectId body.
      if (!serviceRes.ok()) {
        const alt = await proxiedRequest(page, "/services", {
          method: "POST",
          headers: { "content-type": "application/json" },
          data: { projectId: project.id, name: "document-api", type: "API" },
          timeout: 60_000,
          retries: 3
        });
        expect(alt.ok(), await alt.text()).toBeTruthy();
      }

      const connectionRes = await proxiedRequest(page, "/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        data: {
          projectId: project.id,
          applicationId: project.id,
          name: `TEST ONLY OTEL ${slug}`,
          type: "COLLECTOR",
          mode: "OTEL_COLLECTOR",
          environment: "staging",
          authMethod: "API_KEY",
          capabilities: ["telemetry_ingest"],
          configuration: { serviceName: "document-api" },
          authSecret: otelSecret
        },
        timeout: 60_000,
        retries: 3
      });
      expect(connectionRes.ok(), await connectionRes.text()).toBeTruthy();
      const connection = (await connectionRes.json()) as { id: string };

      const payload = {
        resource: {
          serviceName: "document-api",
          deploymentEnvironment: "staging"
        },
        signals: [
          {
            kind: "METRIC",
            name: "http.server.error_rate",
            value: 0.12,
            timestamp: new Date().toISOString()
          },
          {
            kind: "LOG",
            name: "unhandled.exception",
            severity: "CRITICAL",
            body: "Unhandled exception in checkout",
            timestamp: new Date().toISOString()
          },
          {
            kind: "SPAN",
            name: "db.query",
            severity: "HIGH",
            traceId: "a".repeat(32),
            spanId: "b".repeat(16),
            attributes: {
              "db.system": "postgresql",
              "db.name": "documents",
              "peer.service": "documents-db"
            },
            timestamp: new Date().toISOString()
          }
        ]
      };

      const ingestRes = await page.request.post(
        `http://127.0.0.1:4000/api/internal/otel/v1/bridge/connections/${connection.id}`,
        {
          headers: {
            "content-type": "application/json",
            "x-opswatch-connection-key": otelSecret
          },
          data: payload
        }
      );
      expect(ingestRes.ok(), await ingestRes.text()).toBeTruthy();
      const ingestJson = (await ingestRes.json()) as {
        features: Record<string, boolean>;
        signalsAccepted: number;
      };
      expect(ingestJson.signalsAccepted).toBeGreaterThan(0);
      fs.mkdirSync(phase3BrowserDir, { recursive: true });
      fs.writeFileSync(
        path.join(phase3BrowserDir, "ingest-response.json"),
        JSON.stringify(ingestJson, null, 2)
      );

      // Allow worker/inline processing to settle.
      await page.waitForTimeout(2_000);

      await gotoAuthed(page, `/projects/${project.id}`);
      await assertPageReady(page, "Overview", /Overview/i);
      await expect(page.getByTestId("monitoring-depth-summary")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText("Advanced · Logs (Foundation/Preview)")).toBeVisible();
      await expect(page.getByText("Advanced · Traces (Foundation/Preview)")).toBeVisible();
      await expect(page.getByTestId("monitoring-depth-otel")).toBeVisible();
      await expect(page.getByTestId("otel-flag-ingestion")).toBeVisible();
      await expect(page.getByTestId("otel-signal-counts")).toBeVisible();
      await saveShot(page, "01-monitoring-depth-foundation");

      await gotoAuthed(page, `/connections?projectId=${project.id}`);
      await assertPageReady(page, "Connections", /Connections/i);
      await expect(page.getByText(/TEST ONLY OTEL/i).first()).toBeVisible({ timeout: 45_000 });
      await saveShot(page, "02-otel-connection-credential");

      await gotoAuthed(page, `/projects/${project.id}/alerts`);
      await assertPageReady(page, "Alerts", /Alerts/i);
      // Alerts may live under /alerts?projectId=
      if (!(await page.getByText(/OTEL/i).first().isVisible().catch(() => false))) {
        await gotoAuthed(page, `/alerts?projectId=${project.id}`);
        await assertPageReady(page, "Alerts", /Alerts/i);
      }
      await expect(page.getByText(/OTEL/i).first()).toBeVisible({ timeout: 60_000 });
      await saveShot(page, "03-otel-alerts-list");

      const alertLink = page.getByRole("link", { name: /OTEL/i }).first();
      if (await alertLink.isVisible().catch(() => false)) {
        await alertLink.click();
        await assertNotStuckLoading(page, "Alert detail");
        await expect(page.getByTestId("otel-alert-evidence")).toBeVisible({ timeout: 30_000 });
        await saveShot(page, "04-otel-alert-evidence");
      }

      // Ensure worker correlation + OTEL evidence backfill have run.
      const corr = spawnSync("pnpm", ["exec", "tsx", "scripts/otel-phase3-run-correlation.ts"], {
        cwd: path.resolve(process.cwd(), "..", ".."),
        encoding: "utf8",
        shell: true,
        env: {
          ...process.env,
          OPSWATCH_OTEL_INCIDENT_CORRELATION_ENABLED: "true"
        }
      });
      if (corr.status !== 0) {
        console.warn("correlation helper warning", corr.stdout, corr.stderr);
      }
      await page.waitForTimeout(2_000);
      await gotoAuthed(page, `/projects/${project.id}/incidents`);
      await assertPageReady(page, "Incidents", /Incidents/i);
      await saveShot(page, "05-otel-incidents-list");
      const incidentLink = page.getByRole("link").filter({ hasText: /OTEL|document-api|error/i }).first();
      await expect(incidentLink).toBeVisible({ timeout: 60_000 });
      await incidentLink.click();
      await assertNotStuckLoading(page, "Incident detail");
      await expect(page.getByTestId("otel-incident-evidence")).toBeVisible({ timeout: 45_000 });
      await saveShot(page, "06-otel-incident-evidence");

      await gotoAuthed(page, `/projects/${project.id}/topology`);
      await assertPageReady(page, "Topology", /Topology/i);
      await expect(page.getByTestId("otel-topology-overlay")).toBeVisible({
        timeout: 60_000
      });
      await saveShot(page, "07-otel-topology-overlay");

      // Healthy recovery follow-up.
      const healthyPayload = {
        resource: {
          serviceName: "document-api",
          deploymentEnvironment: "staging"
        },
        signals: [
          {
            kind: "METRIC",
            name: "http.server.error_rate",
            value: 0,
            timestamp: new Date().toISOString()
          }
        ]
      };
      const recoverRes = await page.request.post(
        `http://127.0.0.1:4000/api/internal/otel/v1/bridge/connections/${connection.id}`,
        {
          headers: {
            "content-type": "application/json",
            "x-opswatch-connection-key": otelSecret
          },
          data: healthyPayload
        }
      );
      expect(recoverRes.ok(), await recoverRes.text()).toBeTruthy();
      await page.waitForTimeout(1_500);
      await gotoAuthed(page, `/projects/${project.id}`);
      await assertPageReady(page, "Overview", /Overview/i);
      await saveShot(page, "08-after-healthy-followup");

      // Force stale → Unknown via local helper (test-labelled project only).
      const staleResult = spawnSync(
        "pnpm",
        ["exec", "tsx", "scripts/otel-phase3-force-stale.ts", "--projectId", project.id],
        {
          cwd: path.resolve(process.cwd(), "..", ".."),
          encoding: "utf8",
          shell: true,
          env: process.env
        }
      );
      if (staleResult.status !== 0) {
        throw new Error(`force-stale failed: ${staleResult.stdout}\n${staleResult.stderr}`);
      }
      await page.waitForTimeout(1_000);
      await gotoAuthed(page, `/projects/${project.id}`);
      await assertPageReady(page, "Overview", /Overview/i);
      await expect(page.getByText(/stale\/Unknown/i).first()).toBeVisible({ timeout: 45_000 });
      await saveShot(page, "09-stale-unknown");
      await gotoAuthed(page, `/projects/${project.id}/topology`);
      await assertPageReady(page, "Topology", /Topology/i);
      await saveShot(page, "10-topology-stale-unknown");

      fs.writeFileSync(
        path.join(phase3BrowserDir, "JOURNEY.md"),
        [
          "# Phase 3 browser journey",
          "",
          `Project: ${project.id}`,
          `Connection: ${connection.id}`,
          `Ingest features: ${JSON.stringify(ingestJson.features)}`,
          "",
          "Screenshots captured under this directory."
        ].join("\n")
      );
    } catch (error) {
      await writeFailureArtifacts(
        page,
        testInfo,
        issues,
        error instanceof Error ? error.message : "otel-monitoring-depth"
      );
      throw error;
    }
  });
});
