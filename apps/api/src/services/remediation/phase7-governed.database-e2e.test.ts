import { randomUUID } from "crypto";
import http from "http";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env" });

const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("Phase 7 governed remediation database E2E", () => {
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const serviceId = randomUUID();
  const checkId = randomUUID();
  const incidentId = randomUUID();
  const alertId = randomUUID();
  const connectionId = randomUUID();
  const integrationId = randomUUID();
  const operatorUserId = randomUUID();

  let prisma: import("@prisma/client").PrismaClient;
  let executeGovernedRemediation: typeof import("./execution-run.service").executeGovernedRemediation;
  let requestRemediationApproval: typeof import("./approval.service").requestRemediationApproval;
  let decideRemediationApproval: typeof import("./approval.service").decideRemediationApproval;
  let executeReviewHttpExpectedStatus: typeof import("./executors/review-http-expected-status.executor").executeReviewHttpExpectedStatus;
  let ensureRemediationProvidersRegistered: typeof import("./providers/register-providers").ensureRemediationProvidersRegistered;
  let ensureE2EOrgPlan: typeof import("../test-helpers/e2e-org-plan").ensureE2EOrgPlan;

  let healthServer: http.Server;
  let remediatorServer: http.Server;
  let healthPort = 0;
  let remediatorPort = 0;
  let previousAllowLocal: string | undefined;
  let previousAutoRemediation: string | undefined;

  beforeAll(async () => {
    previousAllowLocal = process.env.OPSWATCH_ALLOW_LOCAL_CONNECTION_PROBES;
    previousAutoRemediation = process.env.AUTO_REMEDIATION_ENABLED;
    process.env.OPSWATCH_ALLOW_LOCAL_CONNECTION_PROBES = "true";
    process.env.AUTO_REMEDIATION_ENABLED = "true";

    ({ prisma } = await import("../../lib/prisma"));
    ({ ensureE2EOrgPlan } = await import("../test-helpers/e2e-org-plan"));
    ({
      requestRemediationApproval,
      decideRemediationApproval
    } = await import("./approval.service"));
    ({ executeGovernedRemediation } = await import("./execution-run.service"));
    ({ executeReviewHttpExpectedStatus } = await import(
      "./executors/review-http-expected-status.executor"
    ));
    ({ ensureRemediationProvidersRegistered } = await import("./providers/register-providers"));
    ensureRemediationProvidersRegistered();

    healthServer = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => {
      healthServer.listen(0, "127.0.0.1", () => {
        const addr = healthServer.address();
        healthPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });

    remediatorServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            accepted: true,
            verified: true,
            healthy: true,
            verificationStatus: "healthy",
            echo: body.slice(0, 200)
          })
        );
      });
    });
    await new Promise<void>((resolve) => {
      remediatorServer.listen(0, "127.0.0.1", () => {
        const addr = remediatorServer.address();
        remediatorPort = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    });

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Phase7 Remediation E2E",
        slug: `phase7-remediation-${organizationId.slice(0, 8)}`,
        updatedAt: new Date()
      }
    });
    await ensureE2EOrgPlan(organizationId, "BUSINESS");
    await prisma.user.create({
      data: {
        id: operatorUserId,
        name: "Phase7 E2E Operator",
        email: `phase7-op-${operatorUserId.slice(0, 8)}@e2e.test`,
        passwordHash: "hash",
        role: "AUTOMATION_OPERATOR",
        organizationId,
        isActive: true,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: "Phase7 Test App",
        slug: `phase7-${projectId.slice(0, 8)}`,
        clientName: "E2E",
        environment: "test",
        apiKey: randomUUID(),
        signingSecret: randomUUID(),
        organizationId,
        automationMode: "AUTO_HEAL_SAFE",
        updatedAt: new Date()
      }
    });
    await prisma.service.create({
      data: {
        id: serviceId,
        projectId,
        name: "Phase7 Health Service",
        type: "API",
        baseUrl: `http://127.0.0.1:${healthPort}/health`,
        updatedAt: new Date()
      }
    });
    await prisma.check.create({
      data: {
        id: checkId,
        serviceId,
        name: "Phase7 HTTP check",
        type: "HTTP",
        intervalSeconds: 60,
        timeoutMs: 3000,
        expectedStatusCode: 200,
        isActive: true,
        updatedAt: new Date()
      }
    });
    await prisma.alert.create({
      data: {
        id: alertId,
        projectId,
        serviceId,
        sourceType: "CHECK",
        sourceId: checkId,
        severity: "MEDIUM",
        category: "AVAILABILITY",
        title: "Phase7 test alert",
        message: "Synthetic alert for Phase 7 remediation proofs"
      }
    });
    await prisma.incident.create({
      data: {
        id: incidentId,
        projectId,
        title: "Phase7 test incident",
        severity: "MEDIUM",
        IncidentAlert: { create: [{ alertId }] }
      }
    });
    await prisma.connection.create({
      data: {
        id: connectionId,
        organizationId,
        projectId,
        name: "Phase7 Test Connection",
        type: "HTTP",
        mode: "AGENTLESS",
        environment: "test",
        authMethod: "NONE",
        configurationJson: {
          endpoint: `http://127.0.0.1:${healthPort}/health`,
          method: "GET",
          timeoutMs: 3000
        },
        isActive: true,
        health: "UNKNOWN",
        updatedAt: new Date()
      }
    });
    await prisma.projectIntegration.create({
      data: {
        id: integrationId,
        projectId,
        type: "WORKER_PROVIDER",
        name: "Phase7 Worker Remediator",
        enabled: true,
        validationStatus: "VALID",
        lastValidatedAt: new Date(),
        configJson: {
          WORKER_RESTART_WEBHOOK_URL: `http://127.0.0.1:${remediatorPort}/remediator`,
          REMEDIATOR_WEBHOOK_SECRET: "phase7-e2e-remediator-secret",
          REMEDIATOR_CAPABILITIES: [
            "restart_sync_worker",
            "retry_failed_jobs",
            "restart_outbox_processor",
            "retry_outbox_item"
          ]
        },
        updatedAt: new Date()
      }
    });
  }, 120_000);

  afterAll(async () => {
    if (previousAllowLocal === undefined) {
      delete process.env.OPSWATCH_ALLOW_LOCAL_CONNECTION_PROBES;
    } else {
      process.env.OPSWATCH_ALLOW_LOCAL_CONNECTION_PROBES = previousAllowLocal;
    }
    if (previousAutoRemediation === undefined) {
      delete process.env.AUTO_REMEDIATION_ENABLED;
    } else {
      process.env.AUTO_REMEDIATION_ENABLED = previousAutoRemediation;
    }
    if (healthServer) await new Promise<void>((resolve) => healthServer.close(() => resolve()));
    if (remediatorServer) {
      await new Promise<void>((resolve) => remediatorServer.close(() => resolve()));
    }
    if (prisma) {
      await prisma.remediationExecutionRun.deleteMany({ where: { organizationId } });
      await prisma.remediationApproval.deleteMany({ where: { organizationId } });
      await prisma.remediationCircuitBreaker.deleteMany({ where: { organizationId } });
      await prisma.remediationLog.deleteMany({ where: { organizationId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
      await prisma.$disconnect();
    }
  });

  it(
    "proves autonomous low-risk RERUN_HTTP_CHECK (integration)",
    async () => {
      const outcome = await executeGovernedRemediation({
        context: {
          organizationId,
          projectId,
          serviceId,
          checkId,
          alertId,
          incidentId
        },
        actionKey: "RERUN_HTTP_CHECK",
        automationMode: "AUTONOMOUS",
        requestedBy: undefined,
        idempotencyKey: `phase7-auto-http-${randomUUID()}`
      });

      expect(outcome.providerResult.success).toBe(true);
      expect(
        ["VERIFIED_HEALTHY", "PARTIALLY_RECOVERED", "EXECUTED"].includes(outcome.run.status)
      ).toBe(true);
      const persisted = await prisma.remediationExecutionRun.findFirst({
        where: { id: outcome.run.id, organizationId }
      });
      expect(persisted?.automationMode).toBe("AUTONOMOUS");
      expect(persisted?.actionKey).toBe("RERUN_HTTP_CHECK");
      expect(persisted?.correlationId).toBeTruthy();
    },
    30_000
  );

  it("proves connection TEST_CONNECTION via governed path", async () => {
    const outcome = await executeGovernedRemediation({
      context: {
        organizationId,
        projectId,
        alertId,
        incidentId,
        integrationId: connectionId,
        extra: { connectionId }
      },
      actionKey: "TEST_CONNECTION",
      automationMode: "AUTONOMOUS",
      requestedBy: undefined,
      idempotencyKey: `phase7-conn-${randomUUID()}`
    });

    expect(outcome.providerResult.success).toBe(true);
    expect(outcome.run.provider).toBe("connection");
    const connection = await prisma.connection.findUnique({ where: { id: connectionId } });
    expect(connection?.health).toBe("HEALTHY");
  });

  it(
    "proves Approval mode for RESTART_WORKER (worker remediator)",
    async () => {
      const approval = await requestRemediationApproval({
        context: {
          organizationId,
          projectId,
          incidentId,
          alertId,
          serviceId
        },
        actionKey: "RESTART_WORKER",
        reason: "Phase7 E2E approval proof",
        requestedBy: operatorUserId,
        automationMode: "APPROVAL"
      });

      expect(approval.approvalId).toBeTruthy();
      const decided = await decideRemediationApproval({
        organizationId,
        approvalId: approval.approvalId,
        decision: "APPROVED",
        decidedBy: operatorUserId,
        decisionReason: "Approved for local Phase 7 proof"
      });
      expect(decided.decision).toBe("APPROVED");

      const outcome = await executeGovernedRemediation({
        context: {
          organizationId,
          projectId,
          incidentId,
          alertId,
          serviceId,
          extra: { remediatorAction: "restart_sync_worker" }
        },
        actionKey: "RESTART_WORKER",
        automationMode: "APPROVAL",
        approvalId: approval.approvalId,
        requestedBy: operatorUserId,
        idempotencyKey: `phase7-worker-${randomUUID()}`,
        forceRollbackOnVerificationFailure: false
      });

      expect(outcome.run.approvalId).toBe(approval.approvalId);
      expect(outcome.run.automationMode).toBe("APPROVAL");
      const persisted = await prisma.remediationExecutionRun.findFirst({
        where: { id: outcome.run.id }
      });
      expect(persisted).toBeTruthy();
      expect(persisted?.actionKey).toBe("RESTART_WORKER");
    },
    30_000
  );

  it("proves failed verification with rollback (HTTP expected status)", async () => {
    // Point check at an unreachable URL so post-change verification fails and rolls back.
    await prisma.service.update({
      where: { id: serviceId },
      data: { baseUrl: "http://127.0.0.1:9/not-found", updatedAt: new Date() }
    });
    await prisma.check.update({
      where: { id: checkId },
      data: { expectedStatusCode: 503, updatedAt: new Date() }
    });
    await prisma.checkResult.create({
      data: {
        id: randomUUID(),
        checkId,
        status: "FAIL",
        responseCode: 200,
        responseTimeMs: 12,
        message: "[HTTP_STATUS_MISMATCH] Expected 503, received 200.",
        rawJson: {
          failureClass: "HTTP_STATUS_MISMATCH",
          expectedStatusCode: 503,
          actualStatusCode: 200
        }
      }
    });

    const result = await executeReviewHttpExpectedStatus({
      context: {
        organizationId,
        projectId,
        incidentId,
        serviceId,
        checkId,
        extra: {
          newExpectedStatusCode: 200,
          approvalReason: "Phase7 E2E rollback proof",
          actualStatusCode: 200
        }
      },
      executedBy: operatorUserId
    });

    expect(result.success).toBe(false);
    expect(String(result.summary).toLowerCase()).toMatch(/roll/);

    const check = await prisma.check.findUnique({ where: { id: checkId } });
    expect(check?.expectedStatusCode).toBe(503);
  });
});
