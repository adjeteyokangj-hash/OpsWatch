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

const phase3ArtifactsDir = path.resolve(process.cwd(), "..", "..", "test-artifacts", "phase3");

const savePhase3Screenshot = async (page: import("@playwright/test").Page, name: string) => {
  fs.mkdirSync(phase3ArtifactsDir, { recursive: true });
  await page.screenshot({ path: path.join(phase3ArtifactsDir, `${name}.png`), fullPage: true });
};

test.describe("otel monitoring depth foundation labels", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running."
  );

  test("project page shows Foundation/Preview log and trace labels", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);

    try {
      await loginAs(page, primaryEmail, primaryPassword);
      expect((await sessionCookies(page)).session).toBeTruthy();

      const slug = `pw-otel-${Date.now().toString(36)}`;
      const createRes = await proxiedRequest(page, "/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        data: {
          name: `PW OTEL ${slug}`,
          slug,
          clientName: "Playwright OTEL",
          environment: "testing"
        },
        timeout: 60_000,
        retries: 4
      });
      expect(createRes.ok(), await createRes.text()).toBeTruthy();
      const project = (await createRes.json()) as { id: string };

      await gotoAuthed(page, `/projects/${project.id}`);
      await assertPageReady(page);
      await expect(page.getByTestId("monitoring-depth-summary")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByText("Advanced · Logs (Foundation/Preview)")).toBeVisible();
      await expect(page.getByText("Advanced · Traces (Foundation/Preview)")).toBeVisible();
      await savePhase3Screenshot(page, "monitoring-depth-foundation");
    } catch (error) {
      await writeFailureArtifacts(page, testInfo, issues, error);
      throw error;
    }
  });
});
