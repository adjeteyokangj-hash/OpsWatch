/**
 * Capture rollback (LEGACY reader) evidence screenshot.
 */
import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { chromium } from "@playwright/test";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const out = path.resolve(process.cwd(), "test-artifacts/phase4-cutover");
const webBase = "http://127.0.0.1:3000";
const email = "admin@opswatch.local";
const password = "OpsWatch!2026#LocalDevOnly";
const chromePath =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const main = async () => {
  let loginRes = await fetch(`${webBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!loginRes.ok) {
    // Fall back to direct API login if the web proxy is still warming.
    loginRes = await fetch("http://127.0.0.1:4000/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
  }
  if (!loginRes.ok) {
    throw new Error(`login failed: ${loginRes.status} ${await loginRes.text()}`);
  }
  const setCookies =
    typeof loginRes.headers.getSetCookie === "function" ? loginRes.headers.getSetCookie() : [];
  const cookiePairs = setCookies.map((r) => r.split(";")[0]).filter(Boolean);
  if (!cookiePairs.some((pair) => pair.startsWith("opswatch_session="))) {
    throw new Error(`login missing session cookie: ${cookiePairs.join("; ")}`);
  }

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"]
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(
    cookiePairs.flatMap((pair) => {
      const idx = pair.indexOf("=");
      if (idx <= 0) return [];
      return [{ name: pair.slice(0, idx), value: pair.slice(idx + 1), url: webBase }];
    })
  );
  const page = await context.newPage();
  await page.goto(`${webBase}/projects/app-noble-express/topology`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });
  await page.getByTestId("topology-filter-bar").waitFor({ timeout: 60_000 });
  await page.getByTestId("topology-reader-diagnostic").waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1000);
  const reader = await page.getByTestId("diag-reader").innerText();
  const fallback = await page.getByTestId("diag-fallback").innerText();
  await page.screenshot({
    path: path.join(out, "11-rollback-verification.png"),
    fullPage: true
  });
  fs.writeFileSync(
    path.join(out, "rollback-summary.json"),
    JSON.stringify({ reader, fallback, capturedAt: new Date().toISOString() }, null, 2)
  );
  console.log(JSON.stringify({ reader, fallback }, null, 2));
  await browser.close();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
