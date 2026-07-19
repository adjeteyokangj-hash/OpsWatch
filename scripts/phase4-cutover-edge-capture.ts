/**
 * Focused capture for relationship drawer + OTEL edge + URL entity via ?edgeId= deep-link.
 * LOCAL ONLY.
 */
import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { chromium } from "@playwright/test";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const out = path.resolve(process.cwd(), "test-artifacts/phase4-cutover");
fs.mkdirSync(out, { recursive: true });
const webBase = "http://127.0.0.1:3000";
const apiBase = "http://127.0.0.1:4000";
const email = "admin@opswatch.local";
const password = "OpsWatch!2026#LocalDevOnly";
const chromePath =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const main = async () => {
  const loginRes = await fetch(`${webBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!loginRes.ok) throw new Error(`proxy login failed: ${loginRes.status} ${await loginRes.text()}`);
  const setCookies =
    typeof loginRes.headers.getSetCookie === "function" ? loginRes.headers.getSetCookie() : [];
  const cookiePairs = setCookies.map((r) => r.split(";")[0]).filter(Boolean);
  if (!cookiePairs.some((pair) => pair.startsWith("opswatch_session="))) {
    throw new Error(`proxy login missing session cookie: ${cookiePairs.join("; ")}`);
  }
  const cookieHeader = cookiePairs.join("; ");

  // Topology fetches still go through the API origin with the same session cookie value.
  const fetchTopo = async (projectId: string) => {
    const res = await fetch(`${apiBase}/api/projects/${projectId}/topology`, {
      headers: { cookie: cookieHeader }
    });
    if (!res.ok) {
      // Fall back to web proxy if API rejects the cookie
      const proxy = await fetch(`${webBase}/api/projects/${projectId}/topology`, {
        headers: { cookie: cookieHeader }
      });
      if (!proxy.ok) throw new Error(`topology ${projectId}: api=${res.status} proxy=${proxy.status}`);
      return proxy.json();
    }
    return res.json();
  };

  const noble = await fetchTopo("app-noble-express");
  const temp = await fetchTopo("zz-cutover-temp");
  const nobleEdge =
    (noble.edges as any[]).find((e) => e.type === "DEPENDENCY") ?? (noble.edges as any[])[0];
  const tempEdge =
    (temp.edges as any[]).find((e) => e.type === "DEPENDENCY") ?? (temp.edges as any[])[0];
  const tempWebsite =
    (temp.nodes as any[]).find((n) => {
      const ctx = temp.nodeContext?.[n.id]?.canonical;
      return ctx && ["WEBSITE", "ADMIN_PORTAL"].includes(ctx.entityType);
    }) ?? (temp.nodes as any[])[0];

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

  const goto = async (url: string) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByTestId("topology-filter-bar").waitFor({ timeout: 60_000 });
    await page.waitForTimeout(1800);
  };

  await goto(
    `${webBase}/projects/app-noble-express/topology?edgeId=${encodeURIComponent(nobleEdge.id)}`
  );
  const drawerCount = await page.getByTestId("topology-relationship-drawer").count();
  if (drawerCount === 0) {
    throw new Error("Noble relationship drawer did not open via edgeId deep-link");
  }
  await page.screenshot({
    path: path.join(out, "06-relationship-drawer.png"),
    fullPage: true
  });
  const autoText = await page
    .getByTestId("topology-fix-with-automation")
    .first()
    .innerText()
    .catch(() => null);
  await page.screenshot({
    path: path.join(out, "07-automation-state.png"),
    fullPage: true
  });

  await goto(
    `${webBase}/projects/zz-cutover-temp/topology?edgeId=${encodeURIComponent(tempEdge.id)}`
  );
  const tempDrawer = await page.getByTestId("topology-relationship-drawer").count();
  if (tempDrawer === 0) {
    throw new Error("Temp OTEL relationship drawer did not open via edgeId deep-link");
  }
  const discovery = await page
    .getByTestId("topology-edge-discovery-source")
    .innerText()
    .catch(() => null);
  await page.screenshot({
    path: path.join(out, "08-otel-relationship.png"),
    fullPage: true
  });

  await goto(`${webBase}/projects/zz-cutover-temp/topology`);
  const node = page.getByTestId(`topology-node-${tempWebsite.id}`).first();
  if ((await node.count()) > 0) {
    await node.click({ force: true });
  } else {
    await page.locator('[data-testid^="topology-node-"]').first().click({ force: true });
  }
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(out, "09-url-monitored-entity.png"),
    fullPage: true
  });

  const summary = {
    nobleEdgeId: nobleEdge.id,
    tempEdgeId: tempEdge.id,
    tempWebsiteId: tempWebsite.id,
    drawerVisible: drawerCount > 0,
    tempDrawerVisible: tempDrawer > 0,
    autoText,
    discovery
  };
  fs.writeFileSync(path.join(out, "edge-capture-summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
