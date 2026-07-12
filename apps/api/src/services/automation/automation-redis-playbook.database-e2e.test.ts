import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { seedAutomationPlaybooks } from "./automation-playbooks.seed";
import { planAutomationForIncident } from "./automation-planner.service";
import {
  nobleExpressServiceKeys,
  seedNobleExpressGraph
} from "../../../../../scripts/lib/noble-express-graph.seed";
import { runIncidentCorrelationJob } from "../../../../../apps/worker/src/jobs/run-incident-correlation.job";

const enabled = process.env.RUN_DATABASE_E2E === "true";
const TAG = "automation-redis-playbook-e2e";

describe.runIf(enabled)("automation redis cascade playbook", () => {
  let organizationId = "";
  let projectId = "";
  let incidentId = "";

  beforeAll(async () => {
    const seeded = await seedNobleExpressGraph(prisma);
    await seedAutomationPlaybooks(prisma);

    const project = await prisma.project.findUnique({
      where: { id: seeded.projectId },
      select: { id: true, organizationId: true }
    });
    if (!project?.organizationId) {
      throw new Error("Noble Express project must belong to an organization");
    }

    organizationId = project.organizationId;
    projectId = project.id;

    await prisma.automationPolicy.upsert({
      where: {
        organizationId_policyKey: {
          organizationId,
          policyKey: "GLOBAL"
        }
      },
      update: { executionMode: "OBSERVE", enabled: false, updatedAt: new Date() },
      create: {
        id: randomUUID(),
        organizationId,
        policyKey: "GLOBAL",
        enabled: false,
        executionMode: "OBSERVE",
        updatedBy: TAG,
        updatedAt: new Date()
      }
    });

    const createAlert = async (input: {
      serviceId: string;
      title: string;
      message: string;
      minutesAgo: number;
    }): Promise<string> => {
      const id = randomUUID();
      await prisma.alert.create({
        data: {
          id,
          projectId,
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

    const alertIds = await Promise.all([
      createAlert({
        serviceId: nobleExpressServiceKeys.redis,
        title: "Redis unreachable",
        message: "[CONNECTION_REFUSED] Endpoint refused the connection.",
        minutesAgo: 5
      }),
      createAlert({
        serviceId: nobleExpressServiceKeys.pricingEngine,
        title: "Pricing Engine degraded",
        message: "[CONNECTION_REFUSED] Dependency cache unavailable.",
        minutesAgo: 4
      }),
      createAlert({
        serviceId: nobleExpressServiceKeys.quoteApi,
        title: "Quote API failing",
        message: "[APPLICATION_ERROR] Application is reachable but returning server errors.",
        minutesAgo: 3
      }),
      createAlert({
        serviceId: nobleExpressServiceKeys.customerQuoteJourney,
        title: "Customer Quote Journey degraded",
        message: "[APPLICATION_ERROR] Workflow dependency unavailable.",
        minutesAgo: 2
      })
    ]);

    await runIncidentCorrelationJob();

    const incident = await prisma.incident.findFirst({
      where: {
        projectId,
        IncidentAlert: { some: { alertId: { in: alertIds } } }
      }
    });
    if (!incident) {
      throw new Error("Expected correlated Redis cascade incident");
    }
    incidentId = incident.id;
  });

  afterAll(async () => {
    const alerts = await prisma.alert.findMany({
      where: { projectId, message: { contains: TAG } },
      select: { id: true }
    });
    const alertIds = alerts.map((row) => row.id);
    const incidentLinks = await prisma.incidentAlert.findMany({
      where: { alertId: { in: alertIds } },
      select: { incidentId: true }
    });
    const incidentIds = [...new Set(incidentLinks.map((row) => row.incidentId))];

    await prisma.automationRunStep.deleteMany({
      where: { Run: { incidentId: { in: incidentIds } } }
    });
    await prisma.automationRun.deleteMany({ where: { incidentId: { in: incidentIds } } });
    await prisma.incidentAlert.deleteMany({ where: { alertId: { in: alertIds } } });
    await prisma.incident.deleteMany({ where: { id: { in: incidentIds } } });
    await prisma.alert.deleteMany({ where: { id: { in: alertIds } } });
    await prisma.$disconnect();
  });

  it("plans Redis cascade recovery in OBSERVE mode without executing steps", async () => {
    const plan = await planAutomationForIncident({
      organizationId,
      incidentId,
      createdBy: "e2e"
    });

    expect(plan).not.toBeNull();
    expect(plan?.playbookKey).toBe("REDIS_CASCADE_RECOVERY");
    expect(plan?.executionMode).toBe("OBSERVE");
    expect(plan?.playbookVersion).toBe(1);
    expect(plan?.steps.length).toBeGreaterThanOrEqual(5);
    expect(plan?.reason.toLowerCase()).toContain("redis");

    const rerunRedis = plan?.steps.find((step) => step.order === 1);
    expect(rerunRedis).toMatchObject({
      action: "RERUN_CHECK",
      targetServiceId: nobleExpressServiceKeys.redis,
      approvalRequired: false
    });

    const verifyPricing = plan?.steps.find((step) => step.order === 2);
    expect(verifyPricing).toMatchObject({
      action: "VERIFY_SERVICE",
      targetServiceId: nobleExpressServiceKeys.pricingEngine
    });

    const verifyQuoteApi = plan?.steps.find((step) => step.order === 3);
    expect(verifyQuoteApi).toMatchObject({
      action: "VERIFY_SERVICE",
      targetServiceId: nobleExpressServiceKeys.quoteApi
    });

    const verifyJourney = plan?.steps.find((step) => step.order === 5);
    expect(verifyJourney).toMatchObject({
      action: "VERIFY_SERVICE",
      targetServiceId: nobleExpressServiceKeys.customerQuoteJourney
    });

    const run = await prisma.automationRun.findUnique({
      where: { id: plan!.runId! },
      include: { Steps: { orderBy: { stepOrder: "asc" } } }
    });
    expect(run?.status).toBe("PLANNED");
    expect(run?.executionMode).toBe("OBSERVE");
    expect(run?.Steps.every((step) => step.status === "PENDING")).toBe(true);
  });
});
