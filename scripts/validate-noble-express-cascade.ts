import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { runIncidentCorrelationJob } from "../apps/worker/src/jobs/run-incident-correlation.job";
import { buildIncidentDiagnosis } from "../apps/api/src/services/remediation/remediation-suggest.service";
import {
  nobleExpressServiceKeys,
  seedNobleExpressGraph
} from "./lib/noble-express-graph.seed";

const prisma = new PrismaClient();
const TAG = "noble-express-cascade-validation";

const assertPass = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

const cleanupValidationArtifacts = async (projectId: string): Promise<void> => {
  const alerts = await prisma.alert.findMany({
    where: { projectId, message: { contains: TAG } },
    select: { id: true }
  });
  const alertIds = alerts.map((row) => row.id);
  if (alertIds.length === 0) return;

  const incidentLinks = await prisma.incidentAlert.findMany({
    where: { alertId: { in: alertIds } },
    select: { incidentId: true }
  });
  const incidentIds = [...new Set(incidentLinks.map((row) => row.incidentId))];

  await prisma.incidentTimelineEvent.deleteMany({ where: { incidentId: { in: incidentIds } } });
  await prisma.incidentAlert.deleteMany({ where: { alertId: { in: alertIds } } });
  await prisma.incident.deleteMany({ where: { id: { in: incidentIds } } });
  await prisma.alert.deleteMany({ where: { id: { in: alertIds } } });
};

const createCascadeAlert = async (input: {
  projectId: string;
  serviceId: string;
  title: string;
  message: string;
  minutesAgo: number;
}): Promise<string> => {
  const id = randomUUID();
  await prisma.alert.create({
    data: {
      id,
      projectId: input.projectId,
      serviceId: input.serviceId,
      sourceType: "CHECK",
      sourceId: randomUUID(),
      severity: "HIGH",
      category: "AVAILABILITY",
      title: input.title,
      message: `${TAG} ${input.message}`,
      firstSeenAt: new Date(Date.now() - input.minutesAgo * 60_000),
      lastSeenAt: new Date(Date.now() - input.minutesAgo * 60_000)
    }
  });
  return id;
};

const main = async (): Promise<void> => {
  const seeded = await seedNobleExpressGraph(prisma);
  const project = await prisma.project.findUnique({
    where: { id: seeded.projectId },
    select: { id: true, name: true, organizationId: true }
  });
  assertPass(project?.organizationId, "Noble Express project must belong to an organization");

  await cleanupValidationArtifacts(seeded.projectId);

  const incidentsBefore = await prisma.incident.count({
    where: { projectId: seeded.projectId, status: { not: "RESOLVED" } }
  });

  const alertIds = await Promise.all([
    createCascadeAlert({
      projectId: seeded.projectId,
      serviceId: nobleExpressServiceKeys.redis,
      title: "Redis unreachable",
      message: "[CONNECTION_REFUSED] Endpoint refused the connection.",
      minutesAgo: 5
    }),
    createCascadeAlert({
      projectId: seeded.projectId,
      serviceId: nobleExpressServiceKeys.pricingEngine,
      title: "Pricing Engine degraded",
      message: "[CONNECTION_REFUSED] Dependency cache unavailable.",
      minutesAgo: 4
    }),
    createCascadeAlert({
      projectId: seeded.projectId,
      serviceId: nobleExpressServiceKeys.quoteApi,
      title: "Quote API failing",
      message: "[APPLICATION_ERROR] Application is reachable but returning server errors.",
      minutesAgo: 3
    }),
    createCascadeAlert({
      projectId: seeded.projectId,
      serviceId: nobleExpressServiceKeys.customerQuoteJourney,
      title: "Customer Quote Journey degraded",
      message: "[APPLICATION_ERROR] Workflow dependency unavailable.",
      minutesAgo: 2
    })
  ]);

  await runIncidentCorrelationJob();

  const incidents = await prisma.incident.findMany({
    where: {
      projectId: seeded.projectId,
      IncidentAlert: { some: { alertId: { in: alertIds } } }
    },
    include: { IncidentAlert: true }
  });

  assertPass(incidents.length === 1, `Expected one correlated incident, received ${incidents.length}`);
  const incident = incidents[0]!;

  const incidentsAfter = await prisma.incident.count({
    where: { projectId: seeded.projectId, status: { not: "RESOLVED" } }
  });
  assertPass(
    incidentsAfter === incidentsBefore + 1,
    `Cascade should create exactly one new incident (before=${incidentsBefore}, after=${incidentsAfter})`
  );

  assertPass(
    incident.IncidentAlert.length === alertIds.length,
    `All cascade alerts should correlate into one incident (linked=${incident.IncidentAlert.length}, alerts=${alertIds.length})`
  );

  const diagnosis = await buildIncidentDiagnosis(project.organizationId!, {
    incidentId: incident.id
  });

  assertPass(
    diagnosis.dependencyImpact?.probableRootCause?.serviceName === "Redis",
    `Expected Redis as root cause, received ${diagnosis.dependencyImpact?.probableRootCause?.serviceName ?? "none"}`
  );

  const tracking = diagnosis.layerImpacts?.find((row) => row.serviceName === "Tracking");
  assertPass(tracking?.status === "UNAFFECTED", "Tracking module should remain healthy");

  const app = diagnosis.layerImpacts?.find((row) => row.layer === "APP");
  assertPass(app?.status === "DEGRADED", "Noble Express app should be degraded, not fully down");

  assertPass(
    diagnosis.dependencyImpact?.appHealth === "DEGRADED" ||
      diagnosis.narrative.toLowerCase().includes("degraded"),
    "Diagnosis narrative should describe partial degradation"
  );

  assertPass(
    (diagnosis.dependencyImpact?.propagationChain.length ?? 0) >= 2,
    "Expected a multi-hop propagation chain"
  );

  await cleanupValidationArtifacts(seeded.projectId);

  console.log("NOBLE_EXPRESS_CASCADE_OK");
  console.log(`- Root cause: ${diagnosis.dependencyImpact?.probableRootCause?.serviceName}`);
  console.log(`- App health: ${diagnosis.dependencyImpact?.appHealth ?? app?.status}`);
  console.log(`- Tracking: ${tracking?.status}`);
  console.log(`- Propagation hops: ${diagnosis.dependencyImpact?.propagationChain.length ?? 0}`);
};

void main()
  .catch((error) => {
    console.error("NOBLE_EXPRESS_CASCADE_FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
