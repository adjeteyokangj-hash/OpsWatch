import fs from "fs";
import path from "path";
import { expect, test } from "@playwright/test";
import { attachIssueCollector } from "./helpers/artifacts";
import { primaryEmail, primaryPassword } from "./helpers/constants";
import {
  blockDevNoise,
  loginAs,
  proxiedRequest,
  sessionCookies,
  gotoSafe
} from "./helpers/auth";

const artifactDir = path.resolve(
  process.cwd(),
  "..",
  "..",
  "test-artifacts",
  "ai-policy-centre"
);

const save = async (page: import("@playwright/test").Page, name: string) => {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
};

const writeJson = (name: string, value: unknown) => {
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(path.join(artifactDir, name), JSON.stringify(value, null, 2), "utf8");
};

test.describe("AI & Automation Policy Centre", () => {
  test("enable AI-led, org ceiling, snapshot honesty, emergency stop", async ({ page }) => {
    test.skip(
      process.env.RUN_BROWSER_E2E !== "true",
      "Set RUN_BROWSER_E2E=true with API + web already running."
    );
    test.setTimeout(240_000);
    await blockDevNoise(page);
    attachIssueCollector(page);

    await loginAs(page, primaryEmail, primaryPassword);
    expect((await sessionCookies(page)).session).toBeTruthy();

    const before = await proxiedRequest(page, "/settings/ai-automation-policies", {
      timeout: 45_000
    });
    expect(before.ok()).toBeTruthy();
    const beforeJson = await before.json();
    writeJson("before-snapshot.json", beforeJson);

    const enableRes = await proxiedRequest(page, "/settings/ai-automation-policies/enable-ai-led", {
      method: "POST",
      timeout: 60_000
    });
    expect(enableRes.ok()).toBeTruthy();
    const enableJson = await enableRes.json();
    writeJson("enable-ai-led.json", enableJson);

    const after = await proxiedRequest(page, "/settings/ai-automation-policies", {
      timeout: 45_000
    });
    const afterJson = await after.json();
    writeJson("after-snapshot.json", afterJson);

    expect(afterJson.snapshot?.org?.enabled).toBe(true);
    const effective = String(afterJson.snapshot?.org?.effectiveMode ?? "").toUpperCase();
    expect(["AUTO_HEAL_SAFE", "AUTONOMOUS", "FULL_AUTONOMOUS"]).toContain(effective);
    expect(effective).not.toBe("MONITOR_ONLY");
    expect(effective).not.toBe("OBSERVE");
    expect(afterJson.snapshot?.areas?.length).toBe(25);
    expect(afterJson.snapshot?.allowlist?.actionCount).toBeGreaterThan(0);

    const projectsRes = await proxiedRequest(page, "/projects", { timeout: 30_000 });
    const projects = await projectsRes.json();
    const list = Array.isArray(projects) ? projects : projects?.projects ?? projects?.items ?? [];
    const production = list.find(
      (p: { name?: string; slug?: string }) =>
        p?.name && !/TEST ONLY|pw-|test-/i.test(p.name) && !/TEST ONLY|pw-|test-/i.test(p.slug ?? "")
    );
    if (production?.id) {
      const modeRes = await proxiedRequest(page, `/projects/${production.id}/automation-mode`, {
        timeout: 30_000
      });
      const modeJson = await modeRes.json();
      writeJson("project-automation-mode.json", { projectId: production.id, ...modeJson });
      expect(String(modeJson.effectiveMode ?? "")).not.toMatch(/MONITOR_ONLY|OBSERVE/i);
    }

    await gotoSafe(page, "/settings/ai-automation-policies");
    await expect(page.getByTestId("page-heading")).toContainText(/AI & Automation Policies/i, {
      timeout: 30_000
    });
    await expect(page.getByTestId("action-policies")).toBeVisible();
    await save(page, "policy-centre");

    const ceilingRes = await proxiedRequest(
      page,
      "/settings/ai-automation-policies/organization-ceiling",
      {
        method: "PATCH",
        data: { executionMode: "AUTO_HEAL_SAFE" },
        timeout: 45_000
      }
    );
    expect(ceilingRes.ok()).toBeTruthy();
    writeJson("ceiling-patch.json", await ceilingRes.json());

    if (production?.id) {
      const stopRes = await proxiedRequest(page, "/settings/ai-automation-policies/emergency-stop", {
        method: "PATCH",
        data: { projectId: production.id, disabled: true },
        timeout: 45_000
      });
      expect(stopRes.ok()).toBeTruthy();
      writeJson("emergency-stop-on.json", await stopRes.json());

      const clearRes = await proxiedRequest(page, "/settings/ai-automation-policies/emergency-stop", {
        method: "PATCH",
        data: { projectId: production.id, disabled: false },
        timeout: 45_000
      });
      expect(clearRes.ok()).toBeTruthy();
      writeJson("emergency-stop-off.json", await clearRes.json());
    }

    const audits = afterJson.audits ?? [];
    writeJson("audit-sample.json", audits.slice(0, 10));
    expect(Array.isArray(audits)).toBeTruthy();

    const ops = await proxiedRequest(page, "/intelligence/operations-status", { timeout: 45_000 });
    expect(ops.ok()).toBeTruthy();
    const opsJson = await ops.json();
    writeJson("operations-status.json", opsJson);
    const ids = (opsJson.capabilities ?? []).map((c: { id: string }) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "prediction_notifications",
        "preventive_recommendations",
        "recovery_verification",
        "topology_learning"
      ])
    );

    writeJson("summary.json", {
      orgEffectiveMode: effective,
      areas: afterJson.snapshot?.areas?.length,
      allowlistActions: afterJson.snapshot?.allowlist?.actionCount,
      readinessReady: afterJson.snapshot?.readiness?.ready ?? null,
      partiallyEnabled: !(afterJson.snapshot?.readiness?.ready ?? true)
    });
  });
});
