import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { primaryEmail, primaryPassword, webBase } = require("../e2e/helpers/constants.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, "..", "..", "..", "test-artifacts", "topology-test");
const FAILING_EDGE = "dep-ne-integration-outbox-truenumeris-api-runtime";

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.route("**/_next/webpack-hmr**", (r) => r.abort());
  await page.route("**/*hot-update*", (r) => r.abort());

  const login = await page.request.post(`${webBase}/api/auth/login`, {
    headers: { "content-type": "application/json", "x-opswatch-e2e-rate-limit-bypass": "1" },
    data: { email: primaryEmail, password: primaryPassword },
    failOnStatusCode: false
  });
  if (!login.ok()) {
    throw new Error(`login failed ${login.status()} ${(await login.text()).slice(0, 200)}`);
  }

  await page.goto(`${webBase}/projects/app-noble-express/topology`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  const canvas = page.getByTestId("topology-canvas");
  await canvas.waitFor({ timeout: 60_000 });
  await page.waitForTimeout(2500);
  await canvas.getByRole("button", { name: "Fit", exact: true }).click().catch(() => {});
  await page.waitForTimeout(800);

  const edge = page.getByTestId(`topology-edge-${FAILING_EDGE}`);
  await edge.click({ force: true });
  await page.waitForTimeout(1000);

  let drawer = page.getByTestId("topology-relationship-drawer");
  let drawerOpened = await drawer.isVisible().catch(() => false);
  if (!drawerOpened) {
    const stroke = edge.locator("path, line, polyline").first();
    if (await stroke.count()) {
      await stroke.click({ force: true });
      await page.waitForTimeout(1000);
      drawerOpened = await drawer.isVisible().catch(() => false);
    }
  }

  const setupBtn = page.getByRole("button", { name: /Setup required/i });
  const showsSetupRequired = await setupBtn.isVisible().catch(() => false);
  const screenshotPaths = [];
  const drawerPath = path.join(outDir, "relationship-drawer.png");
  await page.screenshot({ path: drawerPath, fullPage: false });
  screenshotPaths.push(drawerPath);

  let setupRequiredPath = null;
  if (showsSetupRequired || drawerOpened) {
    setupRequiredPath = path.join(outDir, "drawer-setup-required.png");
    await page.screenshot({ path: setupRequiredPath, fullPage: false });
    screenshotPaths.push(setupRequiredPath);
  }

  const meta = {
    drawerOpened,
    showsSetupRequired,
    failingEdge: FAILING_EDGE,
    capturedAt: new Date().toISOString(),
    screenshotPaths,
    setupRequiredPath,
    outDir
  };
  fs.writeFileSync(path.join(outDir, "screenshot-meta.json"), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));
  if (!drawerOpened) process.exit(2);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
