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

test.describe("credential security: org API keys", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running."
  );

  test("create once, rotate or revoke, never see full key again", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);

    try {
      await loginAs(page, primaryEmail, primaryPassword);
      expect((await sessionCookies(page)).session).toBeTruthy();

      await gotoAuthed(page, "/org");
      await assertPageReady(page);

      const keyName = `PW Phase2 ${Date.now().toString(36)}`;
      await page.getByRole("button", { name: "+ Create API Key" }).click();
      await page.locator('input[value="Sparkle production ingest"]').fill(keyName);
      await page.getByRole("button", { name: "Create key" }).click();

      const createdInput = page.getByTestId("created-api-key-value");
      await expect(createdInput).toBeVisible({ timeout: 30_000 });
      const fullKey = await createdInput.inputValue();
      expect(fullKey.length).toBeGreaterThan(12);
      expect(fullKey).toContain(".");

      await savePhase2Screenshot(page, "api-keys-created-once");
      await page.getByRole("button", { name: "Close" }).click();
      await expect(createdInput).not.toBeVisible();

      const prefix = fullKey.split(".")[0].slice(0, 12);
      await expect(page.getByTestId(/api-key-prefix-/)).toContainText(prefix.slice(0, 8));
      await expect(page.locator(`input[value="${fullKey}"]`)).toHaveCount(0);

      const rotateButton = page.getByTestId(/api-key-rotate-/).first();
      if (await rotateButton.isVisible().catch(() => false)) {
        await rotateButton.click();
        await page.getByTestId("confirm-api-key-rotate").click();
        const rotatedInput = page.getByTestId("rotated-api-key-value");
        await expect(rotatedInput).toBeVisible({ timeout: 30_000 });
        const rotatedKey = await rotatedInput.inputValue();
        expect(rotatedKey).not.toBe(fullKey);
        await savePhase2Screenshot(page, "api-keys-rotated-once");
        await page.getByRole("button", { name: "Done" }).click();
        await expect(page.locator(`input[value="${rotatedKey}"]`)).toHaveCount(0);
      } else {
        const revokeButton = page.getByRole("button", { name: "Revoke" }).first();
        await revokeButton.click();
        await page.getByRole("button", { name: "Confirm revoke" }).click();
        await expect(page.getByText("Revoked").first()).toBeVisible({ timeout: 30_000 });
        await savePhase2Screenshot(page, "api-keys-revoked");
      }

      await expect(page.locator(`input[value="${fullKey}"]`)).toHaveCount(0);
    } catch (error) {
      await writeFailureArtifacts(page, testInfo, issues, "credential-security-api-keys");
      throw error;
    }
  });
});
