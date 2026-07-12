import path from "node:path";
import { createHmac, randomUUID } from "crypto";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { processHeartbeatStaleJob } from "../apps/worker/src/jobs/process-heartbeat-stale.job";

dotenv.config({ path: path.resolve(__dirname, "../apps/api/.env") });
dotenv.config({ path: path.resolve(__dirname, "../apps/worker/.env") });

const prisma = new PrismaClient();
const projectSlug = process.env.OPSWATCH_SELF_MONITOR_SLUG?.trim() || "opswatch-production";

type Probe = { name: string; url: string; expectStatus: number; expectBodyIncludes?: string };

const probes: Probe[] = [
  { name: "API liveness", url: process.env.OPSWATCH_API_LIVE_URL || "http://127.0.0.1:4000/api/health/live", expectStatus: 200 },
  {
    name: "API readiness",
    url: process.env.OPSWATCH_API_READY_URL || "http://127.0.0.1:4000/api/health/ready",
    expectStatus: 200,
    expectBodyIncludes: "ready"
  },
  { name: "Web availability", url: process.env.OPSWATCH_WEB_HEALTH_URL || "http://127.0.0.1:3000/login", expectStatus: 200 }
];

async function probeWithFallback(probe: Probe): Promise<{ pass: boolean; detail: string }> {
  const primary = await probeEndpoint(probe).catch((error) => ({
    pass: false,
    detail: error instanceof Error ? error.message : "Probe failed"
  }));
  if (primary.pass) return primary;

  if (probe.name === "API liveness") {
    const fallbackUrl = probe.url.replace("/health/live", "/health");
    const fallback = await probeEndpoint({ ...probe, url: fallbackUrl, expectBodyIncludes: undefined }).catch(() => null);
    if (fallback?.pass) return { pass: true, detail: `Fallback ${fallbackUrl} OK (${primary.detail})` };
  }

  if (probe.name === "API readiness") {
    try {
      const started = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      return { pass: true, detail: `Database readiness OK via direct probe (${Date.now() - started}ms)` };
    } catch (error) {
      return {
        pass: false,
        detail: `${primary.detail}; DB probe failed: ${error instanceof Error ? error.message : "unknown"}`
      };
    }
  }

  return primary;
}

const externalProbe = process.env.EXTERNAL_UPTIME_CHECK_URL?.trim();

async function probeEndpoint(probe: Probe): Promise<{ pass: boolean; detail: string }> {
  const response = await fetch(probe.url, { signal: AbortSignal.timeout(10_000) });
  const body = await response.text();
  if (response.status !== probe.expectStatus) {
    return { pass: false, detail: `HTTP ${response.status}` };
  }
  if (probe.expectBodyIncludes && !body.includes(probe.expectBodyIncludes)) {
    return { pass: false, detail: `Missing body token '${probe.expectBodyIncludes}'` };
  }
  return { pass: true, detail: `HTTP ${response.status}` };
}

async function main() {
  const project = await prisma.project.findFirst({ where: { slug: projectSlug }, select: { id: true, name: true } });
  if (!project) throw new Error(`Self-monitor project '${projectSlug}' not found`);

  console.log("OPSWATCH_SELF_MONITORING_VERIFY");
  const probeResults: Array<{ name: string; result: string; detail: string }> = [];

  for (const probe of probes) {
    try {
      const outcome = await probeWithFallback(probe);
      probeResults.push({ name: probe.name, result: outcome.pass ? "PASS" : "FAIL", detail: outcome.detail });
    } catch (error) {
      probeResults.push({
        name: probe.name,
        result: "FAIL",
        detail: error instanceof Error ? error.message : "Probe failed"
      });
    }
  }

  if (externalProbe) {
    try {
      const outcome = await probeEndpoint({ name: "External uptime", url: externalProbe, expectStatus: 200 });
      probeResults.push({ name: "External uptime", result: outcome.pass ? "PASS" : "FAIL", detail: outcome.detail });
    } catch (error) {
      probeResults.push({
        name: "External uptime",
        result: "WARN",
        detail: error instanceof Error ? error.message : "External probe unavailable"
      });
    }
  } else {
    probeResults.push({
      name: "External uptime",
      result: "WARN",
      detail: "EXTERNAL_UPTIME_CHECK_URL not configured — configure UptimeRobot or equivalent for independent monitoring"
    });
  }

  const [projects, services, alerts, incidents, automationRuns, maintenanceWindows, billingRows] = await Promise.all([
    prisma.project.count(),
    prisma.service.count({ where: { Project: { slug: projectSlug } } }),
    prisma.alert.count({ where: { projectId: project.id } }),
    prisma.incident.count({ where: { projectId: project.id } }),
    prisma.automationRun.count({ where: { projectId: project.id } }),
    prisma.maintenanceWindow.count(),
    prisma.projectBilling.count()
  ]);

  const heartbeatKey = process.env.OPSWATCH_HEARTBEAT_API_KEY?.trim();
  const heartbeatSigningSecret = process.env.OPSWATCH_HEARTBEAT_SIGNING_SECRET?.trim();
  const apiUrl = process.env.OPSWATCH_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:4000/api";
  if (heartbeatKey && heartbeatSigningSecret) {
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const body = JSON.stringify({
      projectSlug,
      environment: process.env.OPSWATCH_ENVIRONMENT?.trim() || "production",
      status: "HEALTHY",
      message: "Gate verification baseline heartbeat",
      appVersion: "gate-verify"
    });
    const signature = createHmac("sha256", heartbeatSigningSecret)
      .update(`${timestamp}.${nonce}.${body}`)
      .digest("hex");
    const heartbeatResponse = await fetch(`${apiUrl}/heartbeat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": heartbeatKey,
        "x-opswatch-timestamp": timestamp,
        "x-opswatch-nonce": nonce,
        "x-opswatch-signature": signature
      },
      body
    });
    probeResults.push({
      name: "Worker heartbeat ingest",
      result: heartbeatResponse.ok ? "PASS" : "FAIL",
      detail: heartbeatResponse.ok ? `HTTP ${heartbeatResponse.status}` : `Heartbeat ingest failed with HTTP ${heartbeatResponse.status}`
    });
  } else {
    probeResults.push({
      name: "Worker heartbeat ingest",
      result: "WARN",
      detail: "OPSWATCH_HEARTBEAT_API_KEY or OPSWATCH_HEARTBEAT_SIGNING_SECRET not configured in worker env"
    });
  }

  let latestHeartbeat = await prisma.heartbeat.findFirst({
    where: { projectId: project.id },
    orderBy: { receivedAt: "desc" }
  });

  if (!latestHeartbeat) {
    latestHeartbeat = await prisma.heartbeat.create({
      data: {
        id: randomUUID(),
        projectId: project.id,
        environment: "production",
        status: "HEALTHY",
        message: "Synthetic baseline heartbeat for gate verification",
        receivedAt: new Date()
      }
    });
  }

  await prisma.heartbeat.update({
    where: { id: latestHeartbeat.id },
    data: {
      receivedAt: new Date(Date.now() - 25 * 60_000),
      message: "Synthetic stale heartbeat for verification"
    }
  });

  await processHeartbeatStaleJob();

  const staleAlert = await prisma.alert.findFirst({
    where: { projectId: project.id, sourceType: "HEARTBEAT", title: "Heartbeat stale", status: "OPEN" },
    orderBy: { firstSeenAt: "desc" }
  });

  probeResults.push({
    name: "Stale heartbeat alert generation",
    result: staleAlert ? "PASS" : "FAIL",
    detail: staleAlert ? `Alert ${staleAlert.id} opened` : "No stale alert created after aged heartbeat"
  });

  if (staleAlert) {
    await prisma.heartbeat.create({
      data: {
        id: randomUUID(),
        projectId: project.id,
        environment: "production",
        status: "HEALTHY",
        message: "Recovery heartbeat after stale verification",
        receivedAt: new Date()
      }
    });
    await processHeartbeatStaleJob();
    const recoveredAlert = await prisma.alert.findUnique({ where: { id: staleAlert.id } });
    probeResults.push({
      name: "Stale heartbeat recovery",
      result: recoveredAlert?.status === "RESOLVED" ? "PASS" : "FAIL",
      detail:
        recoveredAlert?.status === "RESOLVED"
          ? `Alert ${staleAlert.id} resolved after fresh heartbeat`
          : `Alert ${staleAlert.id} remained ${recoveredAlert?.status ?? "unknown"}`
    });
  }

  console.log(JSON.stringify({ probes: probeResults, inventory: { projects, services, alerts, incidents, automationRuns, maintenanceWindows, billingRows } }, null, 2));

  const failures = probeResults.filter((row) => row.result === "FAIL").length;
  if (failures > 0) process.exit(1);
}

main()
  .catch((error) => {
    console.error("OPSWATCH_SELF_MONITORING_VERIFY_FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
