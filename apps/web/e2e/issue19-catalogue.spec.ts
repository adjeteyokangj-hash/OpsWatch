import { expect, test } from "@playwright/test";

test.skip(process.env.RUN_ISSUE19_BROWSER !== "true", "Requires the disposable Issue 19 database and local servers");
test("owner discovery, review, catalogue management and tenant boundaries", async ({ page, browser }, testInfo) => {
  const projectId = testInfo.project.name === "mobile" ? process.env.ISSUE19_MOBILE_PROJECT : process.env.ISSUE19_PROJECT;
  const password = "Issue19!DisposableBrowserOnly";
  const login = await page.request.post("/api/auth/login", { data: { email: "issue19-admin@example.test", password } });
  expect(login.status()).toBe(200);
  const csrf = (await page.context().cookies()).find(cookie => cookie.name === "opswatch_csrf")?.value;
  const before = await (await page.request.get(`/api/projects/${projectId}/topology`)).json();
  await page.goto(`/projects/${projectId}/modules`);
  await page.getByRole("button", { name: "Analyse module evidence" }).click();
  const row = page.getByRole("row").filter({ has: page.getByText("Gameplay", { exact: true }) });
  await expect(row.getByText("PROPOSED", { exact: true })).toBeVisible();
  await row.getByRole("textbox", { name: "Owner note for Gameplay" }).fill("Reviewed against the application description");
  await row.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(row.getByText("APPROVED", { exact: true })).toBeVisible();
  await page.reload();
  await expect(row.getByText("APPROVED", { exact: true })).toBeVisible();
  await expect(row.getByRole("textbox", { name: "Owner note for Gameplay" })).toHaveValue("Reviewed against the application description");
  const after = await (await page.request.get(`/api/projects/${projectId}/topology`)).json();
  expect(after.nodes.map((node: { id: string }) => node.id)).toEqual(before.nodes.map((node: { id: string }) => node.id));
  expect(after.edges).toEqual(before.edges);
  await page.screenshot({ path: `../../test-artifacts/issue19-${testInfo.project.name}-assignments.png`, fullPage: true });

  await page.goto(`/projects/${projectId}/ai-operations`);
  await expect(page.getByRole("heading", { name: "AI Operations", exact: true })).toBeVisible();
  await expect(page.getByTestId("ai-ops-status")).toBeVisible();
  await expect(page.locator('[data-capability="worker_heartbeat"]')).toContainText(/not proven|unhealthy|stale|unavailable/i);
  await page.screenshot({ path: `../../test-artifacts/issue19-${testInfo.project.name}-ai-operations.png`, fullPage: true });

  await page.goto("/module-catalogue");
  await expect(page.getByRole("heading", { name: "Module catalogue", exact: true })).toBeVisible();
  const key = `custom_${testInfo.project.name}`;
  await page.getByLabel("Stable key").fill(key);
  await page.getByLabel("Name", { exact: true }).fill(`Custom ${testInfo.project.name}`);
  await page.getByLabel("Description", { exact: true }).fill("Evidence-backed custom module for this organisation");
  await page.getByLabel("Category", { exact: true }).fill("CUSTOM");
  await page.getByLabel("Discovery terms separated by commas").fill("custom inventory");
  await page.getByRole("button", { name: "Add custom module", exact: true }).click();
  await expect(page.getByRole("button", { name: `Edit Custom ${testInfo.project.name}` })).toBeVisible();
  await page.getByRole("button", { name: `Edit Custom ${testInfo.project.name}` }).click();
  await page.getByRole("combobox", { name: /Status/i }).selectOption("ARCHIVED");
  await page.getByRole("button", { name: "Save module", exact: true }).click();
  await expect(page.getByRole("row").filter({ has: page.getByText(`Custom ${testInfo.project.name}`, { exact: true }) })).toContainText("ARCHIVED");
  await page.screenshot({ path: `../../test-artifacts/issue19-${testInfo.project.name}-catalogue.png`, fullPage: true });

  const outsider = await browser.newContext({ baseURL: "http://127.0.0.1:3109" });
  try {
    expect((await outsider.request.post("/api/auth/login", { data: { email: "issue19-other@example.test", password } })).status()).toBe(200);
    expect((await outsider.request.get(`/api/projects/${projectId}/module-catalogue`)).status()).toBe(404);
    const otherCsrf = (await outsider.cookies()).find(cookie => cookie.name === "opswatch_csrf")?.value;
    expect((await outsider.request.put(`/api/projects/${projectId}/module-catalogue/games`, { headers: { "x-opswatch-csrf": otherCsrf ?? "" }, data: { state: "APPROVED" } })).status()).toBe(404);
    const catalogue = await (await outsider.request.get("/api/module-catalogue")).json();
    expect(catalogue.catalogue.some((definition: { key: string }) => definition.key === key)).toBe(false);
  } finally { await outsider.close(); }
  // Session-backed write without CSRF must still be rejected.
  expect(csrf).toBeTruthy();
  expect((await page.request.put(`/api/projects/${projectId}/module-catalogue/games`, { data: { state: "REMOVED" } })).status()).toBe(403);
});
