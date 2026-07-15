/**
 * Local-dev only: seed fresh check evidence onto Noble Express dependency endpoints
 * so topology can show evidence-based green / amber / red (not invented colours).
 *
 * Freezes checks (isActive=false) so the worker cannot overwrite with ECONNREFUSED noise.
 * Does not invent remediations. Does not push or deploy.
 */
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PROJECT_ID = "app-noble-express";

type EvidenceSpec = {
  serviceId: string;
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  responseTimeMs: number;
  alert?: { title: string; severity: "HIGH" | "MEDIUM"; message: string };
};

const EVIDENCE: EvidenceSpec[] = [
  { serviceId: "svc-ne-redis", name: "Redis health", status: "PASS", responseTimeMs: 8 },
  { serviceId: "svc-ne-postgresql", name: "PostgreSQL health", status: "PASS", responseTimeMs: 22 },
  { serviceId: "svc-ne-pricing-engine", name: "Pricing Engine health", status: "WARN", responseTimeMs: 850 },
  { serviceId: "svc-ne-quote-api", name: "Quote API health", status: "PASS", responseTimeMs: 95 },
  {
    serviceId: "svc-ne-truenumeris-api",
    name: "TrueNumeris API health",
    status: "FAIL",
    responseTimeMs: 4200,
    alert: {
      title: "TrueNumeris API unreachable",
      severity: "HIGH",
      message: "Integration Outbox → TrueNumeris API communication failed (local topology evidence)"
    }
  },
  {
    serviceId: "svc-ne-integration-outbox",
    name: "Integration Outbox health",
    status: "FAIL",
    responseTimeMs: 1200
  }
];

const upsertEvidence = async (spec: EvidenceSpec): Promise<void> => {
  const service = await prisma.service.findFirst({
    where: { id: spec.serviceId, projectId: PROJECT_ID },
    select: { id: true, name: true }
  });
  if (!service) {
    console.warn(`skip missing service ${spec.serviceId}`);
    return;
  }

  const now = new Date();

  await prisma.check.updateMany({
    where: { serviceId: service.id, isActive: true },
    data: { isActive: false, updatedAt: now }
  });

  let check = await prisma.check.findFirst({
    where: { serviceId: service.id, name: spec.name },
    select: { id: true }
  });

  if (!check) {
    check = await prisma.check.create({
      data: {
        id: randomUUID(),
        serviceId: service.id,
        name: spec.name,
        type: "HTTP",
        intervalSeconds: 3600,
        timeoutMs: 5000,
        expectedStatusCode: 200,
        isActive: false,
        updatedAt: now
      },
      select: { id: true }
    });
  } else {
    await prisma.check.update({
      where: { id: check.id },
      data: { isActive: false, updatedAt: now }
    });
  }

  await prisma.checkResult.create({
    data: {
      id: randomUUID(),
      checkId: check.id,
      status: spec.status,
      responseCode: spec.status === "PASS" ? 200 : spec.status === "WARN" ? 200 : 503,
      responseTimeMs: spec.responseTimeMs,
      message: `local topology evidence ${spec.status}`,
      checkedAt: now
    }
  });

  await prisma.service.update({
    where: { id: service.id },
    data: {
      status: spec.status === "FAIL" ? "DOWN" : spec.status === "WARN" ? "DEGRADED" : "HEALTHY"
    }
  });

  await prisma.alert.updateMany({
    where: {
      projectId: PROJECT_ID,
      serviceId: service.id,
      status: { in: ["OPEN", "ACKNOWLEDGED"] }
    },
    data: { status: "RESOLVED", resolvedAt: now }
  });

  if (spec.alert) {
    await prisma.alert.create({
      data: {
        id: randomUUID(),
        projectId: PROJECT_ID,
        serviceId: service.id,
        sourceType: "CHECK",
        severity: spec.alert.severity,
        title: spec.alert.title,
        message: spec.alert.message
      }
    });
  }

  console.log(`${service.name}: ${spec.status} (frozen evidence)`);
};

const main = async (): Promise<void> => {
  const project = await prisma.project.findUnique({ where: { id: PROJECT_ID }, select: { id: true } });
  if (!project) {
    throw new Error(`Project ${PROJECT_ID} not found`);
  }
  for (const row of EVIDENCE) {
    await upsertEvidence(row);
  }
  console.log("Noble Express topology edge evidence seeded.");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
