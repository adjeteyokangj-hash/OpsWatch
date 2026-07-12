import { CheckType, PrismaClient, ProjectStatus, ServiceType } from "@prisma/client";
import { createHash, randomBytes, randomUUID } from "crypto";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(__dirname, "../apps/api/.env") });

type CheckBlueprint = {
  suffix: string;
  type: CheckType;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  expectedStatusCode?: number;
  expectedKeyword?: string;
  maxResponseTimeMs?: number;
};

type LayerDef = {
  layer: "MODULE" | "WORKFLOW" | "COMPONENT";
  key: string;
  name: string;
  type: ServiceType;
  criticality: "HIGH" | "MEDIUM";
  isCritical: boolean;
  urlEnv?: string;
  checks: CheckBlueprint[];
};

const prisma = new PrismaClient();
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const projectSlug = process.env.OPSWATCH_SELF_MONITOR_SLUG?.trim() || "opswatch-production";
const orgSlug = process.env.OPSWATCH_SELF_MONITOR_ORG_SLUG?.trim() || "opswatch-default";

const defaultHttpCheck = (expectedStatusCode = 200): CheckBlueprint[] => [
  {
    suffix: "HTTP availability",
    type: "HTTP",
    intervalSeconds: 60,
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 1,
    expectedStatusCode
  },
  {
    suffix: "Response time",
    type: "RESPONSE_TIME",
    intervalSeconds: 60,
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 1,
    maxResponseTimeMs: 2000
  }
];

const layerDefs: LayerDef[] = [
  { layer: "MODULE", key: "web", name: "Web", type: "MODULE", criticality: "HIGH", isCritical: true, checks: [] },
  { layer: "MODULE", key: "api", name: "API", type: "MODULE", criticality: "HIGH", isCritical: true, checks: [] },
  {
    layer: "MODULE",
    key: "worker-scheduling",
    name: "Worker and scheduling",
    type: "MODULE",
    criticality: "HIGH",
    isCritical: true,
    checks: []
  },
  { layer: "MODULE", key: "database", name: "Database", type: "MODULE", criticality: "HIGH", isCritical: true, checks: [] },
  {
    layer: "MODULE",
    key: "alerting-notifications",
    name: "Alerting and notification delivery",
    type: "MODULE",
    criticality: "HIGH",
    isCritical: true,
    checks: []
  },
  {
    layer: "WORKFLOW",
    key: "user-login",
    name: "User login",
    type: "WORKFLOW",
    criticality: "HIGH",
    isCritical: true,
    urlEnv: "OPSWATCH_WEB_LOGIN_URL",
    checks: defaultHttpCheck(200)
  },
  {
    layer: "WORKFLOW",
    key: "health-signal-ingestion",
    name: "Health signal ingestion",
    type: "WORKFLOW",
    criticality: "HIGH",
    isCritical: true,
    urlEnv: "OPSWATCH_API_LIVE_URL",
    checks: defaultHttpCheck(200)
  },
  {
    layer: "WORKFLOW",
    key: "alert-creation",
    name: "Alert creation",
    type: "WORKFLOW",
    criticality: "HIGH",
    isCritical: true,
    checks: []
  },
  {
    layer: "WORKFLOW",
    key: "incident-creation",
    name: "Incident creation",
    type: "WORKFLOW",
    criticality: "HIGH",
    isCritical: true,
    checks: []
  },
  {
    layer: "WORKFLOW",
    key: "maintenance-transition",
    name: "Maintenance transition",
    type: "WORKFLOW",
    criticality: "MEDIUM",
    isCritical: false,
    checks: []
  },
  {
    layer: "WORKFLOW",
    key: "automation-execution",
    name: "Automation planning and execution",
    type: "WORKFLOW",
    criticality: "HIGH",
    isCritical: true,
    checks: []
  },
  {
    layer: "WORKFLOW",
    key: "notification-delivery",
    name: "Notification delivery",
    type: "WORKFLOW",
    criticality: "HIGH",
    isCritical: true,
    checks: []
  },
  {
    layer: "COMPONENT",
    key: "web-deployment",
    name: "Web deployment",
    type: "FRONTEND",
    criticality: "HIGH",
    isCritical: true,
    urlEnv: "OPSWATCH_WEB_HEALTH_URL",
    checks: defaultHttpCheck(200)
  },
  {
    layer: "COMPONENT",
    key: "api-health-endpoint",
    name: "API health endpoint",
    type: "API",
    criticality: "HIGH",
    isCritical: true,
    urlEnv: "OPSWATCH_API_READY_URL",
    checks: [
      {
        suffix: "Readiness",
        type: "HTTP",
        intervalSeconds: 60,
        timeoutMs: 5000,
        failureThreshold: 2,
        recoveryThreshold: 1,
        expectedStatusCode: 200
      },
      {
        suffix: "Ready payload keyword",
        type: "KEYWORD",
        intervalSeconds: 60,
        timeoutMs: 5000,
        failureThreshold: 2,
        recoveryThreshold: 1,
        expectedKeyword: "ready"
      }
    ]
  },
  {
    layer: "COMPONENT",
    key: "worker-heartbeat",
    name: "Worker heartbeat",
    type: "WORKER",
    criticality: "HIGH",
    isCritical: true,
    checks: []
  },
  {
    layer: "COMPONENT",
    key: "postgresql",
    name: "PostgreSQL",
    type: "DATABASE",
    criticality: "HIGH",
    isCritical: true,
    urlEnv: "OPSWATCH_API_READY_URL",
    checks: defaultHttpCheck(200)
  },
  {
    layer: "COMPONENT",
    key: "scheduler-heartbeat",
    name: "Scheduler heartbeat",
    type: "WORKER",
    criticality: "HIGH",
    isCritical: true,
    checks: []
  },
  {
    layer: "COMPONENT",
    key: "smtp-delivery",
    name: "SMTP delivery check",
    type: "EMAIL",
    criticality: "MEDIUM",
    isCritical: false,
    urlEnv: "OPSWATCH_NOTIFICATION_PROBE_URL",
    checks: defaultHttpCheck(200)
  },
  {
    layer: "COMPONENT",
    key: "webhook-delivery",
    name: "Webhook delivery check",
    type: "WEBHOOK",
    criticality: "MEDIUM",
    isCritical: false,
    urlEnv: "OPSWATCH_WEBHOOK_PROBE_URL",
    checks: defaultHttpCheck(200)
  },
  {
    layer: "COMPONENT",
    key: "external-uptime",
    name: "External uptime probe",
    type: "THIRD_PARTY",
    criticality: "HIGH",
    isCritical: true,
    urlEnv: "EXTERNAL_UPTIME_CHECK_URL",
    checks: defaultHttpCheck(200)
  }
];

const getEnvUrl = (key?: string): string | null => {
  if (!key) return null;
  const value = process.env[key]?.trim();
  return value || null;
};

const ensureProject = async (organizationId: string) => {
  const existing = await prisma.project.findFirst({ where: { organizationId, slug: projectSlug } });
  if (existing) return existing;

  const now = new Date();
  return prisma.project.create({
    data: {
      id: randomUUID(),
      organizationId,
      name: "OpsWatch production",
      slug: projectSlug,
      clientName: "OkangGroup",
      environment: "production",
      description: "Self-monitoring application for OpsWatch platform health",
      status: ProjectStatus.UNKNOWN,
      healthReason: "Awaiting first completed check",
      healthSource: "self-monitor-setup",
      monitoringEnabled: true,
      monitoringStartedAt: now,
      automationMode: "OBSERVE",
      apiKey: randomBytes(16).toString("hex"),
      signingSecret: randomBytes(24).toString("hex"),
      updatedAt: now
    }
  });
};

const ensureService = async (projectId: string, def: LayerDef, baseUrl: string | null) => {
  const existing = await prisma.service.findFirst({ where: { projectId, name: def.name } });
  const data = {
    projectId,
    name: def.name,
    type: def.type,
    status: ProjectStatus.HEALTHY,
    baseUrl,
    isCritical: def.isCritical,
    updatedAt: new Date()
  };
  if (existing) return prisma.service.update({ where: { id: existing.id }, data });
  return prisma.service.create({ data: { id: randomUUID(), ...data } });
};

const ensureCheck = async (serviceId: string, serviceName: string, checkDef: CheckBlueprint, isActive: boolean) => {
  const name = `${serviceName} - ${checkDef.suffix}`;
  const existing = await prisma.check.findFirst({ where: { serviceId, name } });
  const data = {
    serviceId,
    name,
    type: checkDef.type,
    intervalSeconds: checkDef.intervalSeconds,
    timeoutMs: checkDef.timeoutMs,
    expectedStatusCode: checkDef.expectedStatusCode,
    expectedKeyword: checkDef.expectedKeyword,
    failureThreshold: checkDef.failureThreshold,
    recoveryThreshold: checkDef.recoveryThreshold,
    configJson:
      checkDef.type === "RESPONSE_TIME" && checkDef.maxResponseTimeMs
        ? { maxResponseTimeMs: checkDef.maxResponseTimeMs }
        : null,
    isActive,
    updatedAt: new Date()
  };
  if (existing) return prisma.check.update({ where: { id: existing.id }, data });
  return prisma.check.create({ data: { id: randomUUID(), ...data } });
};

const ensureHeartbeatApiKey = async (organizationId: string, projectId: string) => {
  const existing = await prisma.orgApiKey.findFirst({
    where: {
      organizationId,
      projectId,
      name: "OpsWatch self-monitor heartbeat",
      revokedAt: null
    }
  });
  if (existing) {
    return { created: false, key: null as string | null, keyId: existing.keyId };
  }

  const keyId = `ow_${randomBytes(6).toString("hex")}`;
  const secret = randomBytes(24).toString("base64url");
  await prisma.orgApiKey.create({
    data: {
      id: randomUUID(),
      organizationId,
      projectId,
      name: "OpsWatch self-monitor heartbeat",
      keyId,
      secretHash: sha256(secret),
      scopes: ["heartbeats:write"],
      environment: "production"
    }
  });
  return { created: true, key: `${keyId}.${secret}`, keyId };
};

async function main() {
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) throw new Error(`Organization '${orgSlug}' not found. Run db:seed first.`);

  const project = await ensureProject(org.id);
  const appService = await ensureService(project.id, {
    layer: "MODULE",
    key: "app",
    name: "OpsWatch production",
    type: "APP",
    criticality: "HIGH",
    isCritical: true,
    checks: []
  } as LayerDef, getEnvUrl("OPSWATCH_WEB_HEALTH_URL"));

  const summary: Array<{ layer: string; name: string; checks: number; url: string | null }> = [];

  for (const def of layerDefs) {
    const baseUrl = getEnvUrl(def.urlEnv);
    const service = await ensureService(project.id, def, baseUrl);
    let checkCount = 0;
    for (const checkDef of def.checks) {
      await ensureCheck(service.id, def.name, checkDef, Boolean(baseUrl));
      checkCount += 1;
    }
    summary.push({ layer: def.layer, name: def.name, checks: checkCount, url: baseUrl });
  }

  const heartbeatKey = await ensureHeartbeatApiKey(org.id, project.id);

  console.log("OPSWATCH_SELF_MONITORING_READY");
  console.log(
    JSON.stringify(
      {
        organizationSlug: orgSlug,
        projectId: project.id,
        projectSlug: project.slug,
        applicationServiceId: appService.id,
        layers: summary,
        heartbeatApiKeyCreated: heartbeatKey.created,
        heartbeatApiKeyId: heartbeatKey.keyId,
        workerEnv: {
          OPSWATCH_SELF_MONITOR_SLUG: project.slug,
          OPSWATCH_HEARTBEAT_API_KEY: heartbeatKey.created ? "<copy from gate output below>" : "(existing key — rotate in org settings if unknown)",
          OPSWATCH_API_URL: process.env.OPSWATCH_API_URL || "http://127.0.0.1:4000/api"
        }
      },
      null,
      2
    )
  );

  if (heartbeatKey.created && heartbeatKey.key) {
    console.error("");
    console.error("SAVE_WORKER_HEARTBEAT_KEY_ONCE");
    console.error(`OPSWATCH_HEARTBEAT_API_KEY=${heartbeatKey.key}`);
  }
}

main()
  .catch((error) => {
    console.error("OPSWATCH_SELF_MONITORING_SETUP_FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
