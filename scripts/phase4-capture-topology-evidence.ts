/**
 * Phase 4 Playwright evidence for canonical topology UX dimensions.
 * Expects local API + web already running on 127.0.0.1:4000 / :3000.
 * Does not push or deploy.
 */
import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { chromium } from "@playwright/test";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const out = path.resolve(process.cwd(), "test-artifacts/phase4-browser");
fs.mkdirSync(out, { recursive: true });

const base = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  ""
);
const email =
  process.env.PLAYWRIGHT_LOGIN_EMAIL || "admin@opswatch.local";
const password =
  process.env.PLAYWRIGHT_LOGIN_PASSWORD || "OpsWatch!2026#LocalDevOnly";
const chromePath =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const writeJson = (name: string, value: unknown) => {
  fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));
};

const main = async () => {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const project =
    (await prisma.project.findFirst({
      where: { id: "app-noble-express" },
      select: { id: true, name: true, organizationId: true }
    })) ??
    (await prisma.project.findFirst({
      where: { organizationId: { not: null }, name: { contains: "Noble" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, organizationId: true }
    }));
  if (!project?.organizationId) {
    throw new Error("No organised project available for Phase 4 topology evidence");
  }
  await prisma.$disconnect();

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--disable-dev-shm-usage", "--no-sandbox"]
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error.message || error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const loginRes = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!loginRes.ok) {
    throw new Error(
      `proxy login failed: ${loginRes.status} ${await loginRes.text()}`
    );
  }
  const rawCookies =
    typeof loginRes.headers.getSetCookie === "function"
      ? loginRes.headers.getSetCookie()
      : [];
  const cookies = rawCookies.flatMap((row) => {
    const [pair] = row.split(";");
    const idx = pair.indexOf("=");
    if (idx <= 0) return [];
    return [
      {
        name: pair.slice(0, idx),
        value: pair.slice(idx + 1),
        url: base
      }
    ];
  });
  if (!cookies.some((cookie) => cookie.name === "opswatch_session")) {
    throw new Error("proxy login missing opswatch_session cookie");
  }
  await context.addCookies(cookies);

  await page.goto(`${base}/projects/${project.id}/topology`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000
  });
  try {
    await page.getByTestId("topology-filter-bar").waitFor({ timeout: 60_000 });
  } catch (error) {
    await page.screenshot({
      path: path.join(out, "00-topology-filter-bar-missing.png"),
      fullPage: true
    });
    writeJson("failure-body.json", {
      url: page.url(),
      body: (await page.locator("body").innerText()).slice(0, 4000),
      consoleErrors
    });
    throw error;
  }

  await page.screenshot({
    path: path.join(out, "01-topology-map-filters.png"),
    fullPage: true
  });

  const locationOptions = await page
    .getByTestId("topology-location-filter")
    .locator("option")
    .allTextContents();
  const provenanceOptions = await page
    .getByTestId("topology-provenance-filter")
    .locator("option")
    .allTextContents();
  const freshnessOptions = await page
    .getByTestId("topology-freshness-filter")
    .locator("option")
    .allTextContents();

  await page.getByRole("button", { name: /list/i }).click().catch(() => undefined);
  await page.waitForTimeout(500);
  await page.screenshot({
    path: path.join(out, "02-topology-list-location-source.png"),
    fullPage: true
  });

  const firstNode = page.locator(".topology-node, [data-testid^='topology-node']").first();
  if ((await firstNode.count()) > 0) {
    await firstNode.click({ timeout: 10_000 }).catch(() => undefined);
  } else {
    await page.getByRole("row").nth(1).click({ timeout: 10_000 }).catch(() => undefined);
  }
  await page.waitForTimeout(800);
  await page.screenshot({
    path: path.join(out, "03-topology-node-drawer-provenance.png"),
    fullPage: true
  });

  const bodyText = await page.locator("body").innerText();
  writeJson("evidence-summary.json", {
    generatedAt: new Date().toISOString(),
    projectId: project.id,
    projectName: project.name,
    filters: {
      locationOptions,
      provenanceOptions,
      freshnessOptions
    },
    bodyMarkers: {
      hasLocationFilter: /Location/i.test(bodyText),
      hasSourceFilter: /Source/i.test(bodyText),
      hasFreshnessFilter: /Freshness/i.test(bodyText)
    },
    consoleErrors,
    blockingConsoleErrors: consoleErrors.filter(
      (message) => !/status of 404|favicon|_next\/static/i.test(message)
    ),
    passes:
      locationOptions.length > 0 &&
      provenanceOptions.length > 0 &&
      freshnessOptions.length > 0 &&
      consoleErrors.filter(
        (message) => !/status of 404|favicon|_next\/static/i.test(message)
      ).length === 0
  });

  await browser.close();
  console.log(`Phase 4 topology evidence written to ${out}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
