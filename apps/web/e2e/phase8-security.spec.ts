import fs from "fs";
import path from "path";
import { expect, test } from "@playwright/test";
import { attachIssueCollector, writeFailureArtifacts } from "./helpers/artifacts";
import { primaryEmail, primaryPassword } from "./helpers/constants";
import { blockDevNoise, gotoAuthed, loginAs, sessionCookies } from "./helpers/auth";

const artifactDir = path.resolve(process.cwd(), "..", "..", "test-artifacts", "phase8-security");

const saveShot = async (page: import("@playwright/test").Page, name: string) => {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
};

test.describe("phase8 security browser evidence", () => {
  test("capture Security Coverage and workspace evidence", async ({ page }, testInfo) => {
    test.skip(
      process.env.RUN_BROWSER_E2E !== "true",
      "Set RUN_BROWSER_E2E=true with API + web already running."
    );
    test.setTimeout(180_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);

    try {
      await loginAs(page, primaryEmail, primaryPassword);
      expect((await sessionCookies(page)).session).toBeTruthy();

      await gotoAuthed(page, "/security");
      await page.waitForTimeout(2_000);
      await expect(page.getByTestId("security-workspace")).toBeVisible();
      await saveShot(page, "01-security-not-configured");
      await saveShot(page, "02-security-coverage");

      const findings = page.getByTestId("security-findings");
      await expect(findings).toBeVisible();
      await saveShot(page, "03-open-findings");

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      await saveShot(page, "18-mobile-security");
    } catch (error) {
      await writeFailureArtifacts(page, testInfo, issues, error);
      throw error;
    }
  });
});
