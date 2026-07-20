import fs from "fs";
import path from "path";
import { expect, test } from "@playwright/test";
import { attachIssueCollector } from "./helpers/artifacts";
import { primaryEmail, primaryPassword } from "./helpers/constants";
import {
  blockDevNoise,
  gotoAuthed,
  loginAs,
  proxiedRequest,
  sessionCookies
} from "./helpers/auth";

const artifactDir = path.resolve(
  process.cwd(),
  "..",
  "..",
  "test-artifacts",
  "recovery-closure",
  "configure-deeplink"
);

const save = async (page: import("@playwright/test").Page, name: string) => {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
};

const writeJson = (name: string, value: unknown) => {
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, name), JSON.stringify(value, null, 2), "utf8");
};

test.describe("incident configure deeplink runtime evidence", () => {
  test("diagnosis Not configured CTA deep-links to setup with highlight + back link", async ({
    page
  }, testInfo) => {
    test.skip(
      process.env.RUN_BROWSER_E2E !== "true",
      "Set RUN_BROWSER_E2E=true with API + web already running."
    );
    test.setTimeout(180_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);
    const network: Array<{ method: string; status: number; url: string }> = [];
    page.on("response", (res) => {
      const url = res.url();
      if (!/127\.0\.0\.1:(3000|4000)|localhost:(3000|4000)/.test(url)) return;
      if (!/\/api\/(incidents|remediation|projects|auth)/.test(url)) return;
      network.push({ method: res.request().method(), status: res.status(), url });
    });
    const consoleLines: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleLines.push(msg.text());
    });

    await loginAs(page, primaryEmail, primaryPassword);
    expect((await sessionCookies(page)).session).toBeTruthy();

    const incidentsRes = await proxiedRequest(page, "/incidents?limit=20", {
      timeout: 30_000,
      retries: 1
    });
    expect(incidentsRes.ok()).toBeTruthy();
    const incidentsBody = (await incidentsRes.json()) as
      | { incidents?: Array<{ id: string; title?: string; project?: { id: string }; projectId?: string }> }
      | Array<{ id: string; title?: string; project?: { id: string }; projectId?: string }>;
    const incidents = Array.isArray(incidentsBody)
      ? incidentsBody
      : incidentsBody.incidents ?? [];
    expect(incidents.length).toBeGreaterThan(0);

    let target = incidents[0];
    let liveBlocked: unknown = null;
    for (const row of incidents.slice(0, 10)) {
      const sug = await proxiedRequest(page, "/remediation/suggest", {
        method: "POST",
        data: { incidentId: row.id },
        timeout: 45_000,
        retries: 0
      }).catch(() => null);
      if (!sug?.ok()) continue;
      const payload = (await sug.json()) as {
        suggestedActions?: Array<{ action: string; state?: string; missingEnvVars?: string[] }>;
      };
      const blocked = (payload.suggestedActions ?? []).find(
        (sa) => sa.state === "MISCONFIGURED_ENV" || sa.state === "MISSING_CONTEXT"
      );
      if (blocked) {
        target = row;
        liveBlocked = { incidentId: row.id, blocked, diagnosisSnippet: payload };
        break;
      }
    }

    writeJson("01-live-blocked-probe.json", {
      incidentId: target.id,
      liveBlocked,
      incidentCount: incidents.length
    });

    // Ensure deterministic UI path: settings destination with FOO_TOKEN highlight.
    await page.route("**/api/remediation/suggest", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          diagnosis: "Required configuration is missing for the recommended repair.",
          confidence: 0.82,
          category: "RELIABILITY",
          suggestedActions: [
            {
              action: "APPLY_ENV_FIX",
              label: "Apply environment fix",
              description: "Complete missing application configuration.",
              group: "GROUP_A_SAFE",
              requiresApproval: false,
              kind: "fix",
              state: "MISCONFIGURED_ENV",
              missingEnvVars: ["FOO_TOKEN"],
              confidenceLabel: "HIGH",
              confidenceScore: 82,
              policyTier: "SAFE_AUTOMATIC",
              impactTier: "LOW",
              autoRunEligible: false,
              historicalSuccessRate: 0.4,
              suppressionInfo: null,
              confidenceFactors: [
                {
                  name: "Configuration",
                  impact: -20,
                  status: "negative",
                  description: "FOO_TOKEN is not set"
                }
              ]
            }
          ]
        })
      });
    });

    await gotoAuthed(page, `/incidents/${target.id}`);
    await page.waitForTimeout(1500);
    await save(page, "02-incident-diagnosis");

    const configurePill = page.getByRole("link", { name: /Configure required setup/i }).first();
    await expect(configurePill).toBeVisible({ timeout: 20_000 });
    const href = await configurePill.getAttribute("href");
    writeJson("03-configure-href.json", { href, actionTitle: "Apply environment fix" });
    expect(href).toBeTruthy();
    expect(href!).toContain("/settings");
    expect(href!).toMatch(/highlight=FOO_TOKEN|highlight=FOO%5FTOKEN|highlight=FOO_TOKEN/);
    expect(href!).toContain(`returnTo=`);
    expect(decodeURIComponent(href!)).toContain(`/incidents/${target.id}`);

    await expect(page.getByText("Apply environment fix").first()).toBeVisible();
    await expect(page.getByText(/Settings not set:\s*FOO_TOKEN|Missing:\s*FOO_TOKEN/i).first()).toBeVisible();

    await configurePill.click();
    await page.waitForTimeout(1500);
    await save(page, "04-setup-destination");

    await expect(page.getByTestId("configure-setup-return-banner")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("configure-setup-highlight")).toContainText("FOO_TOKEN");
    const back = page.getByTestId("configure-setup-return-link");
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute("href", `/incidents/${target.id}`);

    await back.click();
    await page.waitForTimeout(1000);
    await save(page, "05-back-to-incident");
    expect(page.url()).toContain(`/incidents/${target.id}`);

    writeJson("06-console-network.json", {
      consoleErrors: consoleLines,
      issueConsole: issues.consoleErrors,
      pageErrors: issues.pageErrors,
      failedResponses: issues.failedResponses,
      network: network.slice(-60),
      finalUrl: page.url(),
      testTitle: testInfo.title
    });
    fs.writeFileSync(path.join(artifactDir, "console.txt"), consoleLines.join("\n"), "utf8");
    fs.writeFileSync(
      path.join(artifactDir, "network.txt"),
      network.map((n) => `${n.status} ${n.method} ${n.url}`).join("\n"),
      "utf8"
    );
  });
});