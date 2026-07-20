import { expect, test } from "@playwright/test";
import fs from "fs";
import path from "path";
import { gotoSafe, loginAs, proxiedRequest } from "./helpers/auth";

const evidenceDir = path.resolve(__dirname, "../../../test-artifacts/phase5-product-truth");

const capture = async (page: import("@playwright/test").Page, name: string) => {
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, `${name}.png`), fullPage: true });
};

test.describe("Phase 5 product truth", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with the local API and web stack running."
  );

  test("shows honest capability states and captures evidence", async ({ page }) => {
    test.setTimeout(600_000);
    // Local insights/product and topology can exceed the default 10s expect budget.
    test.info().setTimeout(600_000);
    const slowExpect = expect.configure({ timeout: 90_000 });
    await loginAs(page);

    const projectsResponse = await proxiedRequest(page, "/projects");
    expect(projectsResponse.ok()).toBeTruthy();
    const existingProjects = (await projectsResponse.json()) as Array<{
      id: string;
      name: string;
      environment?: string;
    }>;

    const slug = `phase5-truth-${Date.now().toString(36)}`;
    const createResponse = await proxiedRequest(page, "/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      data: {
        name: `Phase 5 truth ${slug}`,
        slug,
        clientName: "Phase 5 Playwright",
        environment: "test"
      }
    });
    if (!createResponse.ok()) {
      throw new Error(`Failed to create Phase 5 test project: ${createResponse.status()} ${await createResponse.text()}`);
    }
    const testProject = (await createResponse.json()) as { id: string };

    try {
      let topologyProjectId: string | null = null;
      let bestServiceCount = 0;
      for (const candidate of existingProjects) {
        const response = await proxiedRequest(page, `/projects/${candidate.id}`);
        if (!response.ok()) continue;
        const project = (await response.json()) as { services?: unknown[]; Service?: unknown[] };
        const serviceCount = (project.services ?? project.Service ?? []).length;
        if (serviceCount > bestServiceCount) {
          bestServiceCount = serviceCount;
          topologyProjectId = candidate.id;
        }
      }
      expect(topologyProjectId, "A local project with canonical topology is required").toBeTruthy();

      await gotoSafe(page, `/projects/${topologyProjectId}/topology`, 90_000);
      await slowExpect(page.getByTestId("topology-history-state")).toContainText(
        "Historical topology replay is unavailable"
      );
      await slowExpect(page.getByTestId("topology-timeline-truth-label")).toContainText("Live event history");
      await slowExpect(page.getByRole("slider", { name: /topology|history|replay/i })).toHaveCount(0);
      await capture(page, "topology-live-timeline");

      await gotoSafe(page, "/insights", 90_000);
      await slowExpect(page.getByText("Loading insights...")).toHaveCount(0);
      await slowExpect(page.getByTestId("synthetic-draft-truth")).toContainText("not active monitoring");
      await capture(page, "synthetic-draft");

      await gotoSafe(page, `/projects/${testProject.id}/log-streams`, 90_000);
      await slowExpect(page.getByTestId("logs-foundation-state")).toContainText("Foundation");
      await capture(page, "logs-foundation");
      await slowExpect(page.getByTestId("project-test-data-indicator")).toContainText("Test data");
      await capture(page, "test-data-indicator");

      await gotoSafe(page, "/security", 90_000);
      await slowExpect(page.getByTestId("security-workspace")).toBeVisible();
      await slowExpect(page.getByTestId("security-coverage")).toBeVisible();
      await capture(page, "security-workspace");

      await gotoSafe(page, "/intelligence", 90_000);
      await slowExpect(page.getByTestId("predictions-disabled-state")).toContainText("Feature disabled");
      await slowExpect(page.getByTestId("predictions-disabled-state")).toContainText("Live prediction candidates");
      await capture(page, "predictions-disabled");

      await gotoSafe(page, "/connections", 90_000);
      await page.getByRole("button", { name: /add connection/i }).click();
      await slowExpect(page.getByTestId("connection-method")).toContainText("Available");
      await slowExpect(page.getByTestId("connection-method")).toContainText("Planned");
      await capture(page, "connection-catalogue-statuses");

      await gotoSafe(page, "/accuracy", 90_000);
      const unavailable = page.getByTestId("accuracy-unavailable-state");
      if (await unavailable.count()) {
        await slowExpect(unavailable).toContainText("unavailable");
      } else {
        await slowExpect(page.getByText(/Overall Accuracy/i)).toBeVisible();
      }
      await capture(page, "reports-evidence-state");
    } finally {
      await proxiedRequest(page, `/projects/${testProject.id}`, { method: "DELETE" }).catch(() => undefined);
    }
  });
});
