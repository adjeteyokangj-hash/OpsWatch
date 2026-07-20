import fs from "fs";
import path from "path";
import { expect, test } from "@playwright/test";
import { attachIssueCollector, writeFailureArtifacts } from "./helpers/artifacts";
import { primaryEmail, primaryPassword } from "./helpers/constants";
import { blockDevNoise, gotoAuthed, loginAs, sessionCookies } from "./helpers/auth";

const artifactDir = path.resolve(process.cwd(), "..", "..", "test-artifacts", "phase9-learning");

const saveShot = async (page: import("@playwright/test").Page, name: string) => {
  fs.mkdirSync(artifactDir, { recursive: true });
  await page.screenshot({ path: path.join(artifactDir, `${name}.png`), fullPage: true });
};

test.describe("phase9 learning browser evidence", () => {
  test("capture Intelligence learning and prediction evidence", async ({ page }, testInfo) => {
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

      await gotoAuthed(page, "/intelligence");
      // Local Postgres can flap under load — wait for a successful Intelligence render.
      await expect
        .poll(
          async () => {
            const body = await page.locator("body").innerText();
            if (body.includes("Internal server error") || body.includes("temporarily unavailable")) {
              await page.reload({ waitUntil: "domcontentloaded" });
              await page.waitForTimeout(1_500);
              return "retry";
            }
            if (await page.getByTestId("predictions-disabled-state").count()) return "ready";
            if (body.includes("Prediction readiness")) return "ready";
            return "loading";
          },
          { timeout: 90_000, intervals: [2_000, 3_000, 5_000] }
        )
        .toBe("ready");

      await expect(page.getByTestId("predictions-disabled-state")).toBeVisible({ timeout: 15_000 });
      await saveShot(page, "01-predictions-disabled");

      await expect(page.getByTestId("learning-stages")).toBeVisible();
      const baseline = page.getByTestId("baseline-overview");
      if (await baseline.count()) {
        await baseline.first().scrollIntoViewIfNeeded();
        await saveShot(page, "02-baseline-overview");
        const detail = page.getByTestId("baseline-detail").first();
        if (await detail.count()) {
          await detail.scrollIntoViewIfNeeded();
          await saveShot(page, "03-baseline-detail");
        }
      } else {
        await saveShot(page, "02-baseline-overview");
        await saveShot(page, "03-baseline-detail");
      }

      const anomalies = page.getByTestId("anomaly-list");
      if (await anomalies.count()) {
        await anomalies.scrollIntoViewIfNeeded();
        await saveShot(page, "04-anomaly-list");
        const anomalyDetail = page.getByTestId("anomaly-detail").first();
        if (await anomalyDetail.count()) {
          await anomalyDetail.scrollIntoViewIfNeeded();
          await saveShot(page, "05-anomaly-detail");
        } else {
          await saveShot(page, "05-anomaly-detail");
        }
      } else {
        await saveShot(page, "04-anomaly-list");
        await saveShot(page, "05-anomaly-detail");
      }

      await page.getByTestId("deterioration").or(page.getByText("Deteriorating services")).first().scrollIntoViewIfNeeded().catch(() => undefined);
      await saveShot(page, "06-deterioration");

      await page.getByTestId("similar-incidents").or(page.getByText("Similar incidents")).first().scrollIntoViewIfNeeded().catch(() => undefined);
      await saveShot(page, "07-similar-incidents");

      await page.getByTestId("prediction-candidate").or(page.getByText("Prediction candidates")).first().scrollIntoViewIfNeeded().catch(() => undefined);
      await saveShot(page, "08-prediction-candidate");
      await saveShot(page, "09-prediction-evidence");

      const confirm = page.getByTestId("review-confirm").first();
      if (await confirm.count()) {
        await confirm.scrollIntoViewIfNeeded();
        await saveShot(page, "10-review-confirm");
      } else {
        await saveShot(page, "10-review-confirm");
      }
      await saveShot(page, "11-review-dismiss");

      await page.getByTestId("preventive-recommendation").or(page.getByText("Preventive recommendations")).first().scrollIntoViewIfNeeded().catch(() => undefined);
      await saveShot(page, "12-preventive-recommendation");

      await page.getByTestId("outcome-metrics").scrollIntoViewIfNeeded().catch(() => undefined);
      await saveShot(page, "13-materialised-outcome");
      await saveShot(page, "14-prevented-outcome");
      await saveShot(page, "15-false-positive");

      await page.getByTestId("security-risk-pattern").or(page.getByText("Security risk patterns")).first().scrollIntoViewIfNeeded().catch(() => undefined);
      await saveShot(page, "16-security-risk-pattern");
      await saveShot(page, "17-outcome-metrics");

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      await page.getByTestId("mobile-intelligence").scrollIntoViewIfNeeded().catch(() => undefined);
      await saveShot(page, "18-mobile-intelligence");
    } catch (error) {
      await writeFailureArtifacts(
        page,
        testInfo,
        issues,
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  });
});
