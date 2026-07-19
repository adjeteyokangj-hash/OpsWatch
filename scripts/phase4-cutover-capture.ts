/**
 * Phase 4 cutover browser evidence.
 * Captures canonical-reader diagnostic, Noble topology, filters, relationship
 * drawer, automation state, OTEL relationship, URL-monitored entity, mobile.
 * Expects local API + web on 127.0.0.1:4000 / :3000. Does not push or deploy.
 *
 * Optional arg: --label=<suffix> to tag the output filenames (used for rollback).
 */
import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { chromium, type Page, type BrowserContext } from "@playwright/test";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const out = path.resolve(process.cwd(), "test-artifacts/phase4-cutover");
fs.mkdirSync(out, { recursive: true });

const webBase = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const apiBase = (process.env.CUTOVER_API_BASE || "http://127.0.0.1:4000").replace(/\/$/, "");
const email = process.env.PLAYWRIGHT_LOGIN_EMAIL || "admin@opswatch.local";
const password = process.env.PLAYWRIGHT_LOGIN_PASSWORD || "OpsWatch!2026#LocalDevOnly";
const chromePath =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const NOBLE = "app-noble-express";
const TEMP = "zz-cutover-temp";
const labelArg = process.argv.find((a) => a.startsWith("--label="));
const label = labelArg ? `-${labelArg.split("=")[1]}` : "";

const writeJson = (name: string, value: unknown) =>
  fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));

const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: path.join(out, name), fullPage: true });
};

const apiLogin = async (): Promise<string> => {
  const res = await fetch(`${apiBase}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  return setCookies.map((r) => r.split(";")[0]).filter(Boolean).join("; ");
};

const fetchTopology = async (cookie: string, projectId: string) => {
  const res = await fetch(`${apiBase}/api/projects/${projectId}/topology`, { headers: { cookie } });
  if (!res.ok) throw new Error(`topology fetch failed ${projectId}: ${res.status}`);
  return res.json();
};

const gotoTopology = async (page: Page, projectId: string) => {
  await page.goto(`${webBase}/projects/${projectId}/topology`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });
  await page.getByTestId("topology-filter-bar").waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
};

const main = async () => {
  const cookie = await apiLogin();
  const nobleTopo: any = await fetchTopology(cookie, NOBLE);
  const tempTopo: any = await fetchTopology(cookie, TEMP).catch(() => null);

  const nobleDependencyEdge = (nobleTopo.edges ?? []).find((e: any) => e.type === "DEPENDENCY");
  const tempOtelEdge = tempTopo
    ? (tempTopo.edges ?? []).find((e: any) => e.type === "DEPENDENCY")
    : null;
  const tempWebsiteNode = tempTopo
    ? (tempTopo.nodes ?? []).find((n: any) => {
        const ctx = tempTopo.nodeContext?.[n.id]?.canonical;
        return ctx && ["WEBSITE", "ADMIN_PORTAL"].includes(ctx.entityType);
      }) ?? (tempTopo.nodes ?? [])[0]
    : null;

  const summary: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    label: label || "primary",
    nobleReaderDiagnostic: nobleTopo.readerDiagnostic,
    nobleCounts: { nodes: nobleTopo.nodes?.length, edges: nobleTopo.edges?.length },
    tempCounts: tempTopo ? { nodes: tempTopo.nodes?.length, edges: tempTopo.edges?.length } : null,
    captured: [] as string[]
  };
  const captured = summary.captured as string[];

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"]
  });
  const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(
    cookie.split("; ").flatMap((pair) => {
      const idx = pair.indexOf("=");
      if (idx <= 0) return [];
      return [{ name: pair.slice(0, idx), value: pair.slice(idx + 1), url: webBase }];
    })
  );
  const page = await context.newPage();

  const safe = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      captured.push(name);
    } catch (error) {
      writeJson(`ERROR-${name}.json`, { name, error: String((error as Error).message || error) });
    }
  };

  // Noble topology
  await gotoTopology(page, NOBLE);

  await safe(`01-canonical-reader-diagnostic${label}.png`, async () => {
    await page.getByTestId("topology-reader-diagnostic").waitFor({ timeout: 15_000 });
    const readerText = await page.getByTestId("diag-reader").innerText();
    summary.uiReaderText = readerText;
    await shot(page, `01-canonical-reader-diagnostic${label}.png`);
  });

  await safe(`02-noble-full-topology${label}.png`, async () => {
    await shot(page, `02-noble-full-topology${label}.png`);
  });

  await safe(`03-location-filter${label}.png`, async () => {
    const filter = page.getByTestId("topology-location-filter");
    const options = await filter.locator("option").allTextContents();
    summary.locationOptions = options;
    if (options.length > 1) await filter.selectOption({ index: 1 });
    await page.waitForTimeout(500);
    await shot(page, `03-location-filter${label}.png`);
    await filter.selectOption({ index: 0 }).catch(() => undefined);
  });

  await safe(`04-provenance-filter${label}.png`, async () => {
    const filter = page.getByTestId("topology-provenance-filter");
    const options = await filter.locator("option").allTextContents();
    summary.provenanceOptions = options;
    if (options.length > 1) await filter.selectOption({ index: 1 });
    await page.waitForTimeout(500);
    await shot(page, `04-provenance-filter${label}.png`);
    await filter.selectOption({ index: 0 }).catch(() => undefined);
  });

  await safe(`05-freshness-filter${label}.png`, async () => {
    const filter = page.getByTestId("topology-freshness-filter");
    const options = await filter.locator("option").allTextContents();
    summary.freshnessOptions = options;
    if (options.length > 1) await filter.selectOption({ index: 1 });
    await page.waitForTimeout(500);
    await shot(page, `05-freshness-filter${label}.png`);
    await filter.selectOption({ index: 0 }).catch(() => undefined);
  });

  await safe(`06-relationship-drawer${label}.png`, async () => {
    // Prefer a visible dependency edge via data-edge-kind; fall back to hierarchy.
    const dependency = page.locator('[data-edge-kind="dependency"]').first();
    const hierarchy = page.locator('[data-edge-kind="hierarchy"]').first();
    const target = (await dependency.count()) > 0 ? dependency : hierarchy;
    if ((await target.count()) === 0) throw new Error("no clickable topology edges");
    await target.scrollIntoViewIfNeeded().catch(() => undefined);
    await target.click({ timeout: 15_000, force: true });
    await page.getByTestId("topology-relationship-drawer").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await shot(page, `06-relationship-drawer${label}.png`);
  });

  await safe(`07-automation-state${label}.png`, async () => {
    const automation = page.getByTestId("topology-relationship-automation");
    await automation.scrollIntoViewIfNeeded().catch(() => undefined);
    const fix = page.getByTestId("topology-fix-with-automation").first();
    summary.automationButtonText = await fix.innerText().catch(() => null);
    await page.waitForTimeout(300);
    await shot(page, `07-automation-state${label}.png`);
  });

  // Mobile viewport (Noble)
  await safe(`10-mobile-topology${label}.png`, async () => {
    const mobile = await context.newPage();
    await mobile.setViewportSize({ width: 390, height: 844 });
    await mobile.addInitScript(() => undefined);
    await mobile.goto(`${webBase}/projects/${NOBLE}/topology`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000
    });
    await mobile.getByTestId("topology-filter-bar").waitFor({ timeout: 60_000 });
    await mobile.waitForTimeout(1500);
    await mobile.screenshot({ path: path.join(out, `10-mobile-topology${label}.png`), fullPage: true });
    await mobile.close();
  });

  // Temp project: OTEL relationship + URL-monitored entity
  if (tempTopo) {
    await safe(`08-otel-relationship${label}.png`, async () => {
      await gotoTopology(page, TEMP);
      const dependency = page.locator('[data-edge-kind="dependency"]').first();
      if ((await dependency.count()) === 0) throw new Error("no temp dependency edge");
      await dependency.click({ timeout: 15_000, force: true });
      await page.getByTestId("topology-relationship-drawer").waitFor({ timeout: 20_000 });
      await page.waitForTimeout(500);
      summary.otelEdgeDiscoverySource = await page
        .getByTestId("topology-edge-discovery-source")
        .innerText()
        .catch(() => null);
      await shot(page, `08-otel-relationship${label}.png`);
    });

    await safe(`09-url-monitored-entity${label}.png`, async () => {
      await gotoTopology(page, TEMP);
      const website =
        page.locator('[data-testid^="topology-node-"]').filter({ hasText: /Website|example\.com|Public/i }).first();
      const anyNode = page.locator('[data-testid^="topology-node-"]').first();
      const node = (await website.count()) > 0 ? website : anyNode;
      if ((await node.count()) === 0) throw new Error("no temp topology nodes");
      await node.click({ timeout: 15_000, force: true });
      await page.waitForTimeout(800);
      await shot(page, `09-url-monitored-entity${label}.png`);
    });
  }

  // Record diagnostic details from the UI after a fresh Noble load
  await safe(`diag-refresh${label}`, async () => {
    await gotoTopology(page, NOBLE);
    summary.uiReaderText = await page.getByTestId("diag-reader").innerText();
    summary.uiFallbackText = await page.getByTestId("diag-fallback").innerText();
    summary.uiEntityCount = await page.getByTestId("diag-entities").innerText();
    summary.uiRelationshipCount = await page.getByTestId("diag-relationships").innerText();
    summary.uiLegacyFallback = await page.getByTestId("diag-legacy-fallback").innerText();
    summary.uiUnresolved = await page.getByTestId("diag-unresolved").innerText();
  });

  writeJson(`capture-summary${label}.json`, summary);
  await browser.close();
  console.log(`Phase 4 cutover evidence written to ${out}`);
  console.log(JSON.stringify({ captured, label: label || "primary" }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
