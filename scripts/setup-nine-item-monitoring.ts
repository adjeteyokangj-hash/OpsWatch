import { CheckType, PrismaClient, ProjectStatus, ServiceType } from "@prisma/client";
import { randomUUID } from "crypto";

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

type ServiceBlueprint = {
  key: string;
  name: string;
  type: ServiceType;
  criticality: "HIGH" | "MEDIUM";
  isCritical: boolean;
  urlEnv: string;
  checks: CheckBlueprint[];
};

const prisma = new PrismaClient();

const serviceBlueprints: ServiceBlueprint[] = [
  {
    key: "app-server",
    name: "App server",
    type: "API",
    criticality: "HIGH",
    isCritical: true,
    urlEnv: "APP_SERVER_HEALTH_URL",
    checks: [
      {
        suffix: "HTTP availability",
        type: "HTTP",
        intervalSeconds: 60,
        timeoutMs: 5000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        expectedStatusCode: 200
      },
      {
        suffix: "Response time",
        type: "RESPONSE_TIME",
        intervalSeconds: 60,
        timeoutMs: 5000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        maxResponseTimeMs: 1500
      }
    ]
  },
  {
    key: "database",
    name: "Database",
    type: "DATABASE",
    criticality: "HIGH",
    isCritical: true,
    urlEnv: "DATABASE_HEALTH_URL",
    checks: [
      {
        suffix: "HTTP availability",
        type: "HTTP",
        intervalSeconds: 60,
        timeoutMs: 4000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        expectedStatusCode: 200
      },
      {
        suffix: "Health payload keyword",
        type: "KEYWORD",
        intervalSeconds: 60,
        timeoutMs: 4000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        expectedKeyword: "ok"
      }
    ]
  },
  {
    key: "admin-routes",
    name: "Admin routes",
    type: "API",
    criticality: "HIGH",
    isCritical: true,
    urlEnv: "ADMIN_ROUTES_HEALTH_URL",
    checks: [
      {
        suffix: "HTTP availability",
        type: "HTTP",
        intervalSeconds: 60,
        timeoutMs: 5000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        expectedStatusCode: 200
      }
    ]
  },
  {
    key: "customer-quote-api",
    name: "Customer quote API",
    type: "API",
    criticality: "HIGH",
    isCritical: true,
    urlEnv: "CUSTOMER_QUOTE_API_HEALTH_URL",
    checks: [
      {
        suffix: "HTTP availability",
        type: "HTTP",
        intervalSeconds: 60,
        timeoutMs: 5000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        expectedStatusCode: 200
      },
      {
        suffix: "Response time",
        type: "RESPONSE_TIME",
        intervalSeconds: 60,
        timeoutMs: 5000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        maxResponseTimeMs: 1500
      }
    ]
  },
  {
    key: "shop-api",
    name: "Shop API",
    type: "API",
    criticality: "HIGH",
    isCritical: true,
    urlEnv: "SHOP_API_HEALTH_URL",
    checks: [
      {
        suffix: "HTTP availability",
        type: "HTTP",
        intervalSeconds: 60,
        timeoutMs: 5000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        expectedStatusCode: 200
      },
      {
        suffix: "Response time",
        type: "RESPONSE_TIME",
        intervalSeconds: 60,
        timeoutMs: 5000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        maxResponseTimeMs: 1500
      }
    ]
  },
  {
    key: "payments",
    name: "Payments",
    type: "PAYMENT",
    criticality: "HIGH",
    isCritical: true,
    urlEnv: "PAYMENTS_HEALTH_URL",
    checks: [
      {
        suffix: "HTTP availability",
        type: "HTTP",
        intervalSeconds: 60,
        timeoutMs: 4000,
        failureThreshold: 2,
        recoveryThreshold: 2,
        expectedStatusCode: 200
      },
      {
        suffix: "Response time",
        type: "RESPONSE_TIME",
        intervalSeconds: 60,
        timeoutMs: 4000,
        failureThreshold: 2,
        recoveryThreshold: 2,
        maxResponseTimeMs: 1200
      }
    ]
  },
  {
    key: "email-service",
    name: "Email service",
    type: "EMAIL",
    criticality: "MEDIUM",
    isCritical: false,
    urlEnv: "EMAIL_SERVICE_HEALTH_URL",
    checks: [
      {
        suffix: "HTTP availability",
        type: "HTTP",
        intervalSeconds: 120,
        timeoutMs: 5000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        expectedStatusCode: 200
      }
    ]
  },
  {
    key: "cms",
    name: "CMS",
    type: "THIRD_PARTY",
    criticality: "MEDIUM",
    isCritical: false,
    urlEnv: "CMS_HEALTH_URL",
    checks: [
      {
        suffix: "HTTP availability",
        type: "HTTP",
        intervalSeconds: 120,
        timeoutMs: 6000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        expectedStatusCode: 200
      }
    ]
  },
  {
    key: "storage-uploads",
    name: "Storage/uploads",
    type: "THIRD_PARTY",
    criticality: "MEDIUM",
    isCritical: false,
    urlEnv: "STORAGE_UPLOADS_HEALTH_URL",
    checks: [
      {
        suffix: "HTTP availability",
        type: "HTTP",
        intervalSeconds: 120,
        timeoutMs: 6000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        expectedStatusCode: 200
      },
      {
        suffix: "Health payload keyword",
        type: "KEYWORD",
        intervalSeconds: 120,
        timeoutMs: 6000,
        failureThreshold: 3,
        recoveryThreshold: 2,
        expectedKeyword: "ok"
      }
    ]
  }
];

const getEnvUrl = (key: string): string | null => {
  const value = process.env[key]?.trim();
  return value ? value : null;
};

const ensureService = async (projectId: string, def: ServiceBlueprint, baseUrl: string | null) => {
  const existing = await prisma.service.findFirst({
    where: { projectId, name: def.name }
  });

  const data = {
    projectId,
    name: def.name,
    type: def.type,
    status: ProjectStatus.HEALTHY,
    baseUrl,
    isCritical: def.isCritical,
    updatedAt: new Date()
  };

  if (existing) {
    return prisma.service.update({
      where: { id: existing.id },
      data
    });
  }

  return prisma.service.create({
    data: {
      id: randomUUID(),
      ...data
    }
  });
};

const ensureCheck = async (
  serviceId: string,
  serviceName: string,
  checkDef: CheckBlueprint,
  isActive: boolean
) => {
  const name = `${serviceName} - ${checkDef.suffix}`;
  const existing = await prisma.check.findFirst({
    where: { serviceId, name }
  });

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

  if (existing) {
    return prisma.check.update({
      where: { id: existing.id },
      data
    });
  }

  return prisma.check.create({
    data: {
      id: randomUUID(),
      ...data
    }
  });
};

const ensureCoverageTarget = async (
  projectId: string,
  def: ServiceBlueprint,
  isCovered: boolean,
  coverageSource: string
) => {
  return prisma.coverageTarget.upsert({
    where: {
      projectId_targetKey: {
        projectId,
        targetKey: `service:${def.key}`
      }
    },
    create: {
      id: randomUUID(),
      projectId,
      targetType: "SERVICE_HEALTH",
      targetKey: `service:${def.key}`,
      label: def.name,
      criticality: def.criticality,
      isCovered,
      coverageSource,
      detailsJson: {
        serviceType: def.type,
        requiredEnv: def.urlEnv,
        recommendation:
          "Severity progression for check failures is MEDIUM at threshold, HIGH at 3+, CRITICAL at 5+."
      },
      updatedAt: new Date()
    },
    update: {
      label: def.name,
      criticality: def.criticality,
      isCovered,
      coverageSource,
      detailsJson: {
        serviceType: def.type,
        requiredEnv: def.urlEnv,
        recommendation:
          "Severity progression for check failures is MEDIUM at threshold, HIGH at 3+, CRITICAL at 5+."
      },
      updatedAt: new Date()
    }
  });
};

const main = async (): Promise<void> => {
  const projectSlug = process.env.MONITORING_PROJECT_SLUG?.trim();
  if (!projectSlug) {
    throw new Error("MONITORING_PROJECT_SLUG is required");
  }

  const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
  if (!project) {
    throw new Error(`Project '${projectSlug}' not found.`);
  }

  const results: Array<{
    item: string;
    serviceId: string;
    baseUrl: string | null;
    checks: Array<{ name: string; isActive: boolean; failureThreshold: number; recoveryThreshold: number }>;
  }> = [];

  for (const def of serviceBlueprints) {
    const baseUrl = getEnvUrl(def.urlEnv);
    const service = await ensureService(project.id, def, baseUrl);
    const checks = [];

    for (const checkDef of def.checks) {
      const check = await ensureCheck(service.id, def.name, checkDef, Boolean(baseUrl));
      checks.push({
        name: check.name,
        isActive: check.isActive,
        failureThreshold: check.failureThreshold,
        recoveryThreshold: check.recoveryThreshold
      });
    }

    await ensureCoverageTarget(
      project.id,
      def,
      Boolean(baseUrl),
      baseUrl ? "NINE_ITEM_CHECK_PACK" : "NINE_ITEM_CHECK_PACK_MISSING_URL"
    );

    results.push({
      item: def.name,
      serviceId: service.id,
      baseUrl,
      checks
    });
  }

  console.log("NINE_ITEM_MONITORING_PACK_READY");
  console.log(
    JSON.stringify(
      {
        projectSlug,
        hint: "Set all *_HEALTH_URL env vars, rerun this script, then run worker jobs/stack.",
        severityModel: {
          failureThresholdToOpen: "MEDIUM",
          consecutiveFailures3Plus: "HIGH",
          consecutiveFailures5Plus: "CRITICAL"
        },
        items: results
      },
      null,
      2
    )
  );
};

void main()
  .catch((error) => {
    console.error("NINE_ITEM_MONITORING_PACK_FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
