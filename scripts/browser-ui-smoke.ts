/**
 * Authenticated UI route smoke via system Chrome.
 * Establishes session through the same-origin /api proxy (real cookies),
 * then opens each route in a real browser. Login form is checked separately.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { setTimeout as delay } from "timers/promises";

const base = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const email = process.env.PLAYWRIGHT_LOGIN_EMAIL || "admin@opswatch.local";
const password = process.env.PLAYWRIGHT_LOGIN_PASSWORD || "OpsWatch!2026#LocalDevOnly";
const wallMs = Number(process.env.SMOKE_TIMEOUT_MS || 85_000);
const chromePath =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const consoleErrors: string[] = [];
const failedNetwork: string[] = [];
const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
const log = (msg: string) => console.log(`[smoke] ${msg}`);

type JarCookie = { name: string; value: string };

async function loginViaProxy(): Promise<JarCookie[]> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) {
    throw new Error(`proxy login ${res.status} ${await res.text()}`);
  }
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookies: JarCookie[] = [];
  for (const row of raw) {
    const [pair] = row.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) cookies.push({ name: pair.slice(0, idx), value: pair.slice(idx + 1) });
  }
  if (!cookies.some((c) => c.name === "opswatch_session")) {
    throw new Error("proxy login missing opswatch_session cookie");
  }
  return cookies;
}

async function main() {
  log("proxy login...");
  const cookies = await loginViaProxy();
  log(`got ${cookies.length} cookies`);

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    timeout: 25_000,
    args: ["--disable-dev-shm-usage", "--no-sandbox"]
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addCookies(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      url: base
    }))
  );

  const page = await context.newPage();
  await page.route("**/_next/webpack-hmr**", (route) => route.abort());
  await page.route("**/*hot-update*", (route) => route.abort());
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err.message || err)));
  page.on("response", (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 400 && /127\.0\.0\.1:(3000|4000)/.test(url)) {
      if (status === 401 && /\/auth\//.test(url)) return;
      if (/favicon|_next\/static/.test(url)) return;
      failedNetwork.push(`${status} ${url}`);
    }
  });

  const visit = async (path: string, name: string, marker: RegExp) => {
    log(`visit ${path}`);
    await page.goto(`${base}${path}`, { waitUntil: "commit", timeout: 20_000 });
    await delay(120);
    if (page.url().includes("/login")) {
      results.push({ name, ok: false, detail: "redirected to login" });
      return;
    }
    const body = await page.locator("body").innerText();
    const ok =
      !/unexpected application error/i.test(body) && body.length > 40 && marker.test(body);
    results.push({ name, ok, detail: ok ? undefined : `len=${body.length}` });
  };

  try {
    // Login page structure (unauthenticated check in fresh page)
    const loginPage = await context.newPage();
    await loginPage.goto(`${base}/login`, { waitUntil: "commit", timeout: 20_000 });
    await delay(400);
    const hasEmail = await loginPage.locator('form input[type="email"]').count();
    const hasPass = await loginPage.locator('form input[type="password"]').count();
    const hasSubmit = await loginPage.getByRole("button", { name: /sign in/i }).count();
    results.push({
      name: "Login form",
      ok: hasEmail > 0 && hasPass > 0 && hasSubmit > 0,
      detail: `email=${hasEmail} pass=${hasPass} submit=${hasSubmit}`
    });
    await loginPage.close();

    await visit("/dashboard", "Dashboard", /dashboard|command|operations|overview/i);
    await visit("/projects", "Applications", /application|register|project/i);
    await visit("/incidents", "Incidents", /incident/i);
    await visit("/alerts", "Alerts", /alert/i);
    await visit("/automation", "Automation", /automation|playbook/i);
    await visit("/intelligence", "Intelligence", /intelligence|learning|prediction/i);
    await visit("/members", "Team", /member|team|invite|platform/i);
    await visit("/settings", "Settings", /setting/i);
    await visit("/subscription", "Billing", /subscription|billing|plan/i);

    // App detail + topology
    await page.goto(`${base}/projects`, { waitUntil: "commit", timeout: 20_000 });
    await delay(120);
    const href = await page.locator('a[href*="/projects/"]').first().getAttribute("href");
    if (href?.includes("/projects/")) {
      const url = href.startsWith("http") ? href : `${base}${href}`;
      log(`app ${url}`);
      await page.goto(url, { waitUntil: "commit", timeout: 20_000 });
      await delay(120);
      const body = await page.locator("body").innerText();
      results.push({
        name: "App detail",
        ok: body.length > 40 && /overview|module|topology|incident|configuration|health|application/i.test(body)
      });
      const topo = await page.locator('a[href*="topology"]').first().getAttribute("href");
      if (topo) {
        const turl = topo.startsWith("http") ? topo : `${base}${topo}`;
        await page.goto(turl, { waitUntil: "commit", timeout: 20_000 });
        await delay(120);
        const t = await page.locator("body").innerText();
        results.push({
          name: "Topology",
          ok: t.length > 40 && /topology|node|service|layer|empty|graph|health/i.test(t)
        });
      }
    }

    // Connect wizard
    await page.goto(`${base}/projects`, { waitUntil: "commit", timeout: 20_000 });
    await delay(200);
    const register = page.getByRole("button", { name: /register|connect|add application/i }).first();
    if (await register.count()) {
      await register.click();
      await delay(350);
      const text = await page.locator("body").innerText();
      results.push({
        name: "Connect",
        ok: /register|connect|credentials|slug|heartbeat|ingest/i.test(text)
      });
    } else {
      results.push({ name: "Connect", ok: false, detail: "CTA missing" });
    }

    await page.goto(`${base}/intelligence`, { waitUntil: "commit", timeout: 20_000 });
    await delay(120);
    const intel = await page.locator("body").innerText();
    results.push({
      name: "Predictions gated",
      ok: /disabled|not emitting|predictions are disabled|prediction readiness|not ready/i.test(intel)
    });

    // Mobile a11y / overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/dashboard`, { waitUntil: "commit", timeout: 20_000 });
    await delay(250);
    const menu = page.getByRole("button", { name: /menu/i });
    if (await menu.isVisible()) {
      await menu.focus();
      await page.keyboard.press("Enter");
      await delay(150);
      await page.keyboard.press("Tab");
      const tag = await page.evaluate(() => document.activeElement?.tagName ?? "");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      results.push({
        name: "Mobile a11y/overflow",
        ok: ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(tag) && overflow <= 12,
        detail: `focus=${tag} overflowX=${overflow}`
      });
    } else {
      results.push({ name: "Mobile a11y/overflow", ok: false, detail: "menu missing" });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/incidents`, { waitUntil: "commit", timeout: 20_000 });
    await delay(200);
    const deskOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    results.push({ name: "Desktop overflow", ok: deskOverflow <= 12, detail: `overflowX=${deskOverflow}` });
  } finally {
    await browser.close().catch(() => undefined);
  }

  const criticalConsole = consoleErrors.filter((r) => !/favicon|React DevTools|hydration/i.test(r));
  console.log("--- UI SMOKE RESULTS ---");
  for (const row of results) {
    console.log(`${row.ok ? "PASS" : "FAIL"} ${row.name}${row.detail ? ` (${row.detail})` : ""}`);
  }
  if (criticalConsole.length) console.log("CONSOLE", criticalConsole.slice(0, 15).join(" | "));
  if (failedNetwork.length) console.log("NETWORK", [...new Set(failedNetwork)].slice(0, 25).join(" | "));

  if (results.some((r) => !r.ok) || criticalConsole.length || failedNetwork.length) {
    console.log("UI_SMOKE_FAIL");
    process.exitCode = 1;
    return;
  }
  console.log("UI_SMOKE_PASS");
}

const abort = setTimeout(() => {
  console.error("UI_SMOKE_ABORTED");
  process.exit(2);
}, wallMs);

main()
  .catch((err) => {
    console.error("UI_SMOKE_FAIL", err);
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(abort));
