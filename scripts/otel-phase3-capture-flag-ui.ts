/**
 * Capture monitoring-depth screenshots for OTEL feature-flag disabled states.
 * Expects API+web already running; restarts only the API process with new env.
 */
import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";
import { config } from "dotenv";
import { chromium } from "@playwright/test";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const out = path.resolve(process.cwd(), "test-artifacts/phase3-browser");
const logs = path.resolve(process.cwd(), "test-artifacts/stack-logs");
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(logs, { recursive: true });

const apiEnvPath = path.resolve(process.cwd(), "apps/api/.env");

const setFlags = (flags: Record<string, boolean>) => {
  let text = fs.readFileSync(apiEnvPath, "utf8");
  for (const [key, value] of Object.entries(flags)) {
    const line = `${key}=${value ? "true" : "false"}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, line);
    else text += `\n${line}`;
  }
  fs.writeFileSync(apiEnvPath, text);
};

const freePort = (port: number) => {
  try {
    execSync(`powershell -ExecutionPolicy Bypass -File scripts/free-dev-ports.ps1`, {
      stdio: "ignore"
    });
  } catch {
    /* ignore */
  }
  void port;
};

const startApi = () => {
  const root = process.cwd();
  const cmd = `$env:NODE_ENV='development'; $env:OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT='true'; $env:OPSWATCH_ALLOW_E2E_RATE_LIMIT_BYPASS='true'; Set-Location '${root}\\apps\\api'; pnpm exec node dist/index.js *> '${logs}\\api.log'`;
  return spawn("powershell", ["-NoProfile", "-Command", cmd], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
};

const startWeb = () => {
  const root = process.cwd();
  const cmd = `$env:OPSWATCH_EMBEDDED_API='false'; $env:OPSWATCH_API_ORIGIN='http://127.0.0.1:4000'; Set-Location '${root}'; pnpm --filter @opswatch/web start *> '${logs}\\web.log'`;
  return spawn("powershell", ["-NoProfile", "-Command", cmd], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
};

const waitHealth = async (ms = 120_000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const api = await fetch("http://127.0.0.1:4000/api/health");
      const web = await fetch("http://127.0.0.1:3000/login");
      if (api.ok && web.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("stack not healthy");
};

async function screenshotFlags(name: string, projectId: string) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3000/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).fill(process.env.PLAYWRIGHT_LOGIN_EMAIL || "admin@opswatch.local");
  await page.getByLabel(/password/i).fill(
    process.env.PLAYWRIGHT_LOGIN_PASSWORD || "OpsWatch!2026#LocalDevOnly"
  );
  await page.getByRole("button", { name: /sign in|log in|login/i }).click();
  await page.waitForURL(/dashboard|projects/, { timeout: 60_000 }).catch(() => undefined);
  await page.goto(`http://127.0.0.1:3000/projects/${projectId}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("monitoring-depth-otel").waitFor({ timeout: 45_000 });
  await page.screenshot({ path: path.join(out, name), fullPage: true });
  const dump = {
    ingestion: await page.getByTestId("otel-flag-ingestion").innerText(),
    topology: await page.getByTestId("otel-flag-topology").innerText(),
    alerts: await page.getByTestId("otel-flag-alerts").innerText(),
    incidents: await page.getByTestId("otel-flag-incidents").innerText(),
    notes: await page.getByTestId("otel-processing-notes").innerText().catch(() => null)
  };
  fs.writeFileSync(path.join(out, name.replace(".png", ".json")), JSON.stringify(dump, null, 2));
  console.log(name, dump);
  await browser.close();
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const project = await prisma.project.findFirst({
    where: { name: { contains: "PW OTEL" } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (!project) throw new Error("No PW OTEL project found");
  await prisma.$disconnect();

  const restore = {
    OPSWATCH_OTEL_INGESTION_ENABLED: true,
    OPSWATCH_OTEL_TOPOLOGY_DISCOVERY_ENABLED: true,
    OPSWATCH_OTEL_ALERT_GENERATION_ENABLED: true,
    OPSWATCH_OTEL_INCIDENT_CORRELATION_ENABLED: true
  };

  try {
    // Alerts disabled
    setFlags({
      OPSWATCH_OTEL_INGESTION_ENABLED: true,
      OPSWATCH_OTEL_TOPOLOGY_DISCOVERY_ENABLED: true,
      OPSWATCH_OTEL_ALERT_GENERATION_ENABLED: false,
      OPSWATCH_OTEL_INCIDENT_CORRELATION_ENABLED: false
    });
    freePort(4000);
    startApi();
    startWeb();
    await waitHealth();
    await screenshotFlags("11-flags-alerts-disabled.png", project.id);

    // Alerts on, incident correlation off
    setFlags({
      OPSWATCH_OTEL_INGESTION_ENABLED: true,
      OPSWATCH_OTEL_TOPOLOGY_DISCOVERY_ENABLED: true,
      OPSWATCH_OTEL_ALERT_GENERATION_ENABLED: true,
      OPSWATCH_OTEL_INCIDENT_CORRELATION_ENABLED: false
    });
    freePort(4000);
    startApi();
    startWeb();
    await waitHealth();
    await screenshotFlags("12-flags-incident-correlation-disabled.png", project.id);
  } finally {
    setFlags(restore);
    freePort(4000);
    startApi();
    startWeb();
    await waitHealth().catch(() => undefined);
    console.log("flags restored");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
