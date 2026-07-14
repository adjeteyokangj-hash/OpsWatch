/**
 * Poll local API + web + DB until ready for Playwright smoke.
 *
 *   pnpm exec tsx scripts/wait-local-stack.ts
 */
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { parseEnvFile } from "./lib/env-utils";

const rootDir = path.resolve(__dirname, "..");
const apiEnv = parseEnvFile(path.join(rootDir, "apps/api/.env"));
for (const key of ["DATABASE_URL"] as const) {
  if (!process.env[key] && apiEnv[key]) {
    process.env[key] = apiEnv[key];
  }
}

const apiHealth = (process.env.OPSWATCH_API_HEALTH_URL || "http://127.0.0.1:4000/api/health").replace(
  /\/$/,
  ""
);
const loginUrl = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "") + "/login";
const maxMs = Number(process.env.STACK_WAIT_MS || 180_000);
const intervalMs = 2_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function checkHttp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Connectivity only - empty orgs must not fail readiness (fixtures run after). */
async function checkDb(prisma: PrismaClient): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.log("db check: DATABASE_URL missing (apps/api/.env not loaded?)");
    return false;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("db check failed: " + message.split("\n")[0]);
    return false;
  }
}

async function main() {
  const started = Date.now();
  // Reuse one client — creating PrismaClient every poll can starve local Postgres max_connections.
  const prisma = new PrismaClient();
  console.log("Waiting for stack: " + apiHealth + " + " + loginUrl + " + DB");
  try {
    while (Date.now() - started < maxMs) {
      const [apiOk, webOk, dbOk] = await Promise.all([
        checkHttp(apiHealth),
        checkHttp(loginUrl),
        checkDb(prisma)
      ]);
      console.log("poll api=" + apiOk + " web=" + webOk + " db=" + dbOk);
      if (apiOk && webOk && dbOk) {
        console.log("STACK_READY");
        return;
      }
      await sleep(intervalMs);
    }
    console.error("STACK_NOT_READY");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
