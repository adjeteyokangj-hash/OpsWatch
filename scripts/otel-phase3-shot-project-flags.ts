import fs from "fs";
import path from "path";
import { config } from "dotenv";
import { chromium } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

config({ path: path.resolve(process.cwd(), "apps/api/.env") });

const outName = process.argv[2];
if (!outName) throw new Error("Usage: otel-phase3-shot-project-flags.ts <basename>");

const out = path.resolve(process.cwd(), "test-artifacts/phase3-browser");
fs.mkdirSync(out, { recursive: true });

async function main() {
  const prisma = new PrismaClient();
  const project = await prisma.project.findFirst({
    where: { name: { contains: "PW OTEL" } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  if (!project) throw new Error("No PW OTEL project");

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3000/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).fill(process.env.PLAYWRIGHT_LOGIN_EMAIL || "admin@opswatch.local");
  await page.getByLabel(/password/i).fill(
    process.env.PLAYWRIGHT_LOGIN_PASSWORD || "OpsWatch!2026#LocalDevOnly"
  );
  await page.getByRole("button", { name: /sign in|log in|login/i }).click();
  await page.waitForURL(/dashboard|projects/, { timeout: 60_000 }).catch(() => undefined);
  await page.goto(`http://127.0.0.1:3000/projects/${project.id}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("monitoring-depth-otel").waitFor({ timeout: 45_000 });
  await page.screenshot({ path: path.join(out, `${outName}.png`), fullPage: true });
  const dump = {
    ingestion: await page.getByTestId("otel-flag-ingestion").innerText(),
    topology: await page.getByTestId("otel-flag-topology").innerText(),
    alerts: await page.getByTestId("otel-flag-alerts").innerText(),
    incidents: await page.getByTestId("otel-flag-incidents").innerText(),
    notes: await page.getByTestId("otel-processing-notes").innerText().catch(() => null)
  };
  fs.writeFileSync(path.join(out, `${outName}.json`), JSON.stringify(dump, null, 2));
  console.log(JSON.stringify(dump));
  await browser.close();
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
