/**
 * Capture remaining Phase 3 browser evidence (incident evidence + flag notes).
 */
import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { chromium } from "@playwright/test";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const out = path.resolve(process.cwd(), "test-artifacts/phase3-browser");
fs.mkdirSync(out, { recursive: true });

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const project = await prisma.project.findFirst({
    where: { name: { contains: "PW OTEL" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true }
  });
  const incident = project
    ? await prisma.incident.findFirst({
        where: { projectId: project.id },
        orderBy: { openedAt: "desc" },
        select: { id: true, title: true }
      })
    : null;
  console.log(JSON.stringify({ projectId: project?.id, incidentId: incident?.id, title: incident?.title }));

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3000/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).fill(process.env.PLAYWRIGHT_LOGIN_EMAIL || "admin@opswatch.local");
  await page.getByLabel(/password/i).fill(
    process.env.PLAYWRIGHT_LOGIN_PASSWORD || "OpsWatch!2026#LocalDevOnly"
  );
  await page.getByRole("button", { name: /sign in|log in|login/i }).click();
  await page.waitForURL(/dashboard|projects/, { timeout: 60_000 }).catch(() => undefined);

  if (incident?.id) {
    await page.goto(`http://127.0.0.1:3000/incidents/${incident.id}`, {
      waitUntil: "domcontentloaded"
    });
    await page.waitForTimeout(2_000);
    const ev = page.getByTestId("otel-incident-evidence");
    if (await ev.isVisible().catch(() => false)) {
      await page.screenshot({
        path: path.join(out, "06-otel-incident-evidence.png"),
        fullPage: true
      });
      console.log("captured 06");
    } else {
      await page.screenshot({
        path: path.join(out, "06-otel-incident-missing-evidence.png"),
        fullPage: true
      });
      console.log("incident page without evidence testid");
    }
  } else {
    console.log("no incident for latest PW OTEL project");
  }

  if (project?.id) {
    await page.goto(`http://127.0.0.1:3000/projects/${project.id}`, {
      waitUntil: "domcontentloaded"
    });
    await page.waitForTimeout(1_500);
    const flags = {
      ingestion: await page.getByTestId("otel-flag-ingestion").innerText().catch(() => null),
      topology: await page.getByTestId("otel-flag-topology").innerText().catch(() => null),
      alerts: await page.getByTestId("otel-flag-alerts").innerText().catch(() => null),
      incidents: await page.getByTestId("otel-flag-incidents").innerText().catch(() => null),
      notes: await page.getByTestId("otel-processing-notes").innerText().catch(() => null),
      foundationLogs: await page.getByTestId("monitoring-depth-logs").innerText().catch(() => null),
      foundationTraces: await page
        .getByTestId("monitoring-depth-traces")
        .innerText()
        .catch(() => null),
      stale: await page.getByTestId("otel-discovered").innerText().catch(() => null)
    };
    fs.writeFileSync(path.join(out, "flag-enabled-ui.json"), JSON.stringify(flags, null, 2));
    console.log("flag-enabled-ui", flags);
  }

  await browser.close();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
