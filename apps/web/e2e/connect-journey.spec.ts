import { createHmac, randomUUID } from "crypto";
import { expect, test } from "@playwright/test";
import { apiBase, isIgnorableConsole, primaryEmail, primaryPassword, proxiedApiBase } from "./helpers/constants";
import { attachIssueCollector, writeFailureArtifacts } from "./helpers/artifacts";
import {
  apiAuthHeaders,
  assertPageReady,
  blockDevNoise,
  gotoAuthed,
  gotoSafe,
  loginAs,
  proxiedRequest,
  sessionCookies
} from "./helpers/auth";

const redact = (value: string) => {
  if (!value) return "(empty)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-4)} (len=${value.length})`;
};

const signBody = (secret: string, timestamp: string, nonce: string, rawBody: string) =>
  createHmac("sha256", secret).update(`${timestamp}.${nonce}.${rawBody}`).digest("hex");

test.describe("automated connect journey", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running."
  );

  test("register → signed heartbeat → UI evidence (no fake predictions)", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);

    try {
      await loginAs(page, primaryEmail, primaryPassword);
      const cookies = await sessionCookies(page);
      expect(cookies.session).toBeTruthy();
      expect(cookies.csrf).toBeTruthy();

      let slug = `pw-connect-${Date.now().toString(36)}`;
      let createRes = await proxiedRequest(page, "/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        data: {
          name: `PW Connect ${slug}`,
          slug,
          clientName: "Playwright Connect",
          environment: "local"
        },
        timeout: 60_000,
        retries: 6
      });
      if (!createRes.ok()) {
        await page.waitForTimeout(2000);
        slug = `pw-connect-${Date.now().toString(36)}`;
        createRes = await proxiedRequest(page, "/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          data: {
            name: `PW Connect ${slug}`,
            slug,
            clientName: "Playwright Connect",
            environment: "local"
          },
          timeout: 60_000,
          retries: 6
        });
      }
      expect(createRes.ok(), `create project ${createRes.status()} ${await createRes.text()}`).toBeTruthy();
      const created = (await createRes.json()) as {
        id: string;
        ingestCredentials?: { signingSecret?: string; apiKey?: string };
        signingSecret?: string;
      };
      const projectId = created.id;
      let signingSecret = String(created.ingestCredentials?.signingSecret || created.signingSecret || "");
      let apiKey = String(created.ingestCredentials?.apiKey || "");
      if (!signingSecret) {
        const projectRes = await proxiedRequest(page, `/projects/${projectId}`);
        expect(projectRes.ok(), `project fetch ${projectRes.status()}`).toBeTruthy();
        const project = (await projectRes.json()) as {
          ingestCredentials?: { signingSecret?: string; apiKey?: string };
          signingSecret?: string;
        };
        signingSecret = String(project.ingestCredentials?.signingSecret || project.signingSecret || "");
        if (!apiKey) apiKey = String(project.ingestCredentials?.apiKey || "");
      }
      expect(projectId).toBeTruthy();
      expect(signingSecret, "signing secret").toBeTruthy();
      // eslint-disable-next-line no-console
      console.log(`CONNECT project=${projectId} slug=${slug} secret=${redact(signingSecret)} key=${redact(apiKey)}`);

      if (!apiKey) {
        const keyRes = await proxiedRequest(page, "/org/api-keys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          data: {
            name: `pw-connect-${slug}`,
            environment: "test",
            scopes: ["events:write", "heartbeats:write"],
            projectId
          },
          retries: 4
        });
        expect(keyRes.ok(), `api key ${keyRes.status()}`).toBeTruthy();
        const keyPayload = (await keyRes.json()) as { key?: string; apiKey?: string };
        apiKey = String(keyPayload.key || keyPayload.apiKey || "");
      }
      expect(apiKey, "api key").toBeTruthy();
      // eslint-disable-next-line no-console
      console.log(`CONNECT key=${redact(apiKey)}`);

      // Before heartbeat: UI may show waiting
      await gotoAuthed(page, `/projects/${projectId}`, new RegExp(`/projects/${projectId}`));
      await expect(page.locator("body")).not.toContainText(/unexpected application error/i);

      const body = {
        projectSlug: slug,
        environment: "local",
        appVersion: "pw-connect-1",
        status: "HEALTHY",
        message: "Playwright connect journey heartbeat"
      };
      const rawBody = JSON.stringify(body);
      const timestamp = new Date().toISOString();
      const nonce = randomUUID();
      const signature = signBody(signingSecret, timestamp, nonce, rawBody);

      const heartbeatRes = await page.request.post(`${apiBase}/heartbeat`, {
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "x-opswatch-timestamp": timestamp,
          "x-opswatch-nonce": nonce,
          "x-opswatch-signature": signature
        },
        data: body
      });
      expect(heartbeatRes.ok(), `heartbeat ${heartbeatRes.status()} ${await heartbeatRes.text()}`).toBeTruthy();

      // Poll project until waiting clears (targeted, not global bang)
      let status = "UNKNOWN";
      let healthLabel = "";
      for (let i = 0; i < 20; i += 1) {
        const projectRes = await proxiedRequest(page, `/projects/${projectId}`);
        expect(projectRes.ok(), `project poll ${projectRes.status()}`).toBeTruthy();
        const project = (await projectRes.json()) as {
          status?: string;
          healthStatus?: string;
          healthDisplayLabel?: string;
          healthReason?: string;
          lastSignalAt?: string | null;
        };
        status = String(project.status || project.healthStatus || "");
        healthLabel = String(project.healthDisplayLabel || project.healthReason || "");
        if (status.toUpperCase() !== "UNKNOWN" && !/waiting for first heartbeat/i.test(healthLabel)) {
          break;
        }
        await page.waitForTimeout(750);
      }
      expect(status.toUpperCase(), `status=${status} label=${healthLabel}`).not.toBe("UNKNOWN");
      expect(healthLabel).not.toMatch(/waiting for first heartbeat/i);

      // Workspace shell loads project client-side; wait for context (do not remount each poll).
      await gotoAuthed(page, `/projects/${projectId}`, new RegExp(`/projects/${projectId}`));
      await expect(page.locator("body")).not.toContainText(/Loading project context/i, {
        timeout: 45_000
      });
      let uiText = "";
      for (let attempt = 0; attempt < 6; attempt += 1) {
        uiText = await page.locator("body").innerText();
        if (
          (new RegExp(slug.slice(0, 12), "i").test(uiText) || /PW Connect/i.test(uiText)) &&
          !/waiting for first heartbeat/i.test(uiText)
        ) {
          break;
        }
        await page.waitForTimeout(1500);
      }
      expect(uiText).toMatch(new RegExp(`${slug.slice(0, 12)}|PW Connect`, "i"));
      expect(uiText).not.toMatch(/waiting for first heartbeat/i);
      expect(uiText).toMatch(/last|signal|heartbeat|healthy|seen|check|just now/i);

      const topoRes = await proxiedRequest(page, `/projects/${projectId}/topology`);
      // topology may be empty but must be org-owned reachable
      expect([200, 404]).toContain(topoRes.status());
      if (topoRes.ok()) {
        await gotoAuthed(page, `/projects/${projectId}/topology`);
        await expect(page.locator("body")).not.toContainText(/unexpected application error/i);
      }

      await gotoSafe(page, "/intelligence");
      await expect(page.locator("body")).not.toContainText(/Loading workspace/i, { timeout: 45_000 });
      if (!/\/intelligence/i.test(page.url())) {
        const intelLink = page.getByRole("link", { name: /intelligence/i }).first();
        await expect(intelLink).toBeVisible({ timeout: 10_000 });
        await intelLink.click();
        await page.waitForTimeout(1500);
      }
      await expect(
        page.getByText(/disabled|not emitting|predictions are disabled|prediction readiness|not ready|intelligence/i).first()
      ).toBeVisible({ timeout: 30_000 });
      const intel = await page.locator("body").innerText();
      expect(intel).not.toMatch(/failure probability|will fail in|predicted outage/i);

      const criticalConsole = issues.consoleErrors
        .concat(issues.pageErrors)
        .filter((row) => !isIgnorableConsole(row));
      expect(criticalConsole, criticalConsole.join(" | ")).toEqual([]);

      // eslint-disable-next-line no-console
      console.log("CONNECT_JOURNEY_PASS", slug, status);
    } catch (error) {
      const dir = await writeFailureArtifacts(page, testInfo, issues, "connect-journey");
      // eslint-disable-next-line no-console
      console.error("ARTIFACTS", dir);
      throw error;
    }
  });
});
