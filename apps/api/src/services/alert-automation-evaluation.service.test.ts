import { describe, expect, it, vi, beforeEach } from "vitest";
import { AlertStatus } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  alert: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn()
  },
  heartbeat: {
    findMany: vi.fn()
  },
  remediationExecutionRun: {
    findFirst: vi.fn()
  },
  connection: {
    findFirst: vi.fn()
  },
  checkResult: {
    findFirst: vi.fn()
  }
}));

vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));

import {
  evaluateAlertAutomation,
  progressHeartbeatAlertRecovery,
  rankAlertRemediationCandidates,
  isPrivateTargetMonitoringBlock,
  HEARTBEAT_RECOVERY_MIN_COUNT,
  HEARTBEAT_RECOVERY_STABLE_SECONDS
} from "./alert-automation-evaluation.service";

describe("alert automation evaluation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.remediationExecutionRun.findFirst.mockResolvedValue(null);
    prismaMock.connection.findFirst.mockResolvedValue(null);
    prismaMock.checkResult.findFirst.mockResolvedValue(null);
  });

  it("evaluates observe-mode alerts as OBSERVE_ONLY with an honest reason", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({
      id: "alert-1",
      title: "Heartbeat stale",
      message: "No heartbeat received",
      category: "AVAILABILITY",
      sourceType: "HEARTBEAT",
      sourceId: null,
      status: AlertStatus.OPEN,
      projectId: "proj-1",
      serviceId: null,
      firstSeenAt: new Date("2026-07-15T10:00:00.000Z"),
      lastSeenAt: new Date("2026-07-15T10:30:00.000Z"),
      resolvedAt: null,
      Project: { id: "proj-1", name: "Noble Express", automationMode: "OBSERVE" }
    });

    const result = await evaluateAlertAutomation({ alertId: "alert-1", organizationId: "org-1" });
    expect(result.evaluationStatus).toBe("OBSERVE_ONLY");
    expect(result.availabilityState).toBe("OBSERVE_ONLY");
    expect(result.availabilityReason).toMatch(/Observe/i);
    expect(result.selectedAction).toBeTruthy();
    expect(result.primaryCtaKind).toBe("OBSERVE_BLOCKED");
  });

  it("does not select RETRY_WEBHOOKS for private-target monitoring blocks", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({
      id: "alert-pg",
      title: "PostgreSQL - Response time failing",
      message: "[NETWORK_UNREACHABLE] Local, private, and metadata targets are not allowed",
      category: "PERFORMANCE",
      sourceType: "CHECK",
      sourceId: "check-1",
      status: AlertStatus.OPEN,
      projectId: "proj-1",
      serviceId: "svc-1",
      firstSeenAt: new Date("2026-07-19T09:15:14.000Z"),
      lastSeenAt: new Date("2026-07-20T09:16:26.000Z"),
      resolvedAt: null,
      Project: { id: "proj-1", name: "OpsWatch production", automationMode: "MONITOR_ONLY" }
    });
    prismaMock.checkResult.findFirst.mockResolvedValue({
      message: "Local, private, and metadata targets are not allowed",
      responseCode: null,
      rawJson: { failureClass: "NETWORK_UNREACHABLE" }
    });

    const result = await evaluateAlertAutomation({ alertId: "alert-pg", organizationId: "org-1" });
    expect(result.primaryCtaKind).toBe("CONFIGURE_CHECK");
    expect(result.failureClass).toBe("MONITORING_TARGET_BLOCKED");
    expect(result.selectedAction).not.toBe("RETRY_WEBHOOKS");
    expect(result.availableActions).not.toContain("RETRY_WEBHOOKS");
    expect(result.checkId).toBe("check-1");
    expect(result.configureHref).toBe("/checks/check-1");
    expect(result.diagnosisSummary).toMatch(/configuration|private/i);
  });

  it("ranks diagnosis-suggested actions ahead of registry order", () => {
    const preferred = rankAlertRemediationCandidates({
      candidates: [
        {
          actionKey: "RETRY_WEBHOOKS",
          displayName: "Retry webhooks",
          state: "OBSERVE_ONLY",
          reason: "Observe",
          riskLevel: "LOW",
          requiresApproval: false,
          providerType: "notification",
          verificationStrategy: "NONE",
          rollbackCapability: "NONE",
          requiredScopes: [],
          supportedAutomationModes: ["OBSERVE"]
        },
        {
          actionKey: "RERUN_HTTP_CHECK",
          displayName: "Rerun HTTP check",
          state: "OBSERVE_ONLY",
          reason: "Observe",
          riskLevel: "LOW",
          requiresApproval: false,
          providerType: "opswatch_native",
          verificationStrategy: "IMMEDIATE_CHECK_RESULT",
          rollbackCapability: "NONE",
          requiredScopes: [],
          supportedAutomationModes: ["OBSERVE"]
        }
      ] as any,
      suggestedActions: ["RERUN_HTTP_CHECK", "REQUEST_HUMAN_REVIEW"],
      excludeNotificationRetries: true
    });
    expect(preferred?.actionKey).toBe("RERUN_HTTP_CHECK");
  });

  it("detects private-target monitoring block messages", () => {
    expect(
      isPrivateTargetMonitoringBlock(
        "[NETWORK_UNREACHABLE] Local, private, and metadata targets are not allowed"
      )
    ).toBe(true);
  });

  it("does not claim remediation caused recovery when an alert is already resolved", async () => {
    prismaMock.alert.findFirst.mockResolvedValue({
      id: "alert-2",
      title: "Heartbeat stale",
      message: "resolved",
      category: "AVAILABILITY",
      sourceType: "HEARTBEAT",
      sourceId: null,
      status: AlertStatus.RESOLVED,
      projectId: "proj-1",
      serviceId: null,
      firstSeenAt: new Date("2026-07-15T09:00:00.000Z"),
      lastSeenAt: new Date("2026-07-15T11:00:00.000Z"),
      resolvedAt: new Date("2026-07-15T11:00:00.000Z"),
      Project: { id: "proj-1", name: "Noble Express", automationMode: "APPROVAL" }
    });

    const result = await evaluateAlertAutomation({ alertId: "alert-2", organizationId: "org-1" });
    expect(result.evaluationStatus).toBe("RECOVERED_NATURALLY");
    expect(result.remediationCausedRecovery).toBe(false);
    expect(result.verificationPassed).toBe(true);
  });
});

describe("progressHeartbeatAlertRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks OPEN heartbeat alerts RECOVERING when evidence is insufficient", async () => {
    prismaMock.alert.findMany.mockResolvedValue([
      {
        id: "alert-open",
        status: AlertStatus.OPEN,
        message: "No heartbeat from noble for 12 minutes"
      }
    ]);
    const now = Date.now();
    prismaMock.heartbeat.findMany.mockResolvedValue([
      { id: "hb-1", receivedAt: new Date(now), status: "HEALTHY" },
      { id: "hb-2", receivedAt: new Date(now - 30_000), status: "HEALTHY" }
    ]);
    prismaMock.alert.update.mockResolvedValue({});

    const result = await progressHeartbeatAlertRecovery("proj-1");
    expect(result.recovering).toBe(1);
    expect(result.resolved).toBe(0);
    expect(prismaMock.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "alert-open" },
        data: expect.objectContaining({ status: "RECOVERING" })
      })
    );
  });

  it("resolves only after consecutive healthy heartbeats over the stable window", async () => {
    prismaMock.alert.findMany.mockResolvedValue([
      {
        id: "alert-rec",
        status: "RECOVERING",
        message: "No heartbeat [recovering: awaiting 3 healthy heartbeats]"
      }
    ]);
    const now = Date.now();
    prismaMock.heartbeat.findMany.mockResolvedValue(
      Array.from({ length: HEARTBEAT_RECOVERY_MIN_COUNT }, (_, index) => ({
        id: `hb-${index}`,
        receivedAt: new Date(now - index * (HEARTBEAT_RECOVERY_STABLE_SECONDS * 1000) / 2),
        status: "HEALTHY"
      }))
    );
    // Ensure span between newest and oldest >= stable seconds
    prismaMock.heartbeat.findMany.mockResolvedValue([
      { id: "hb-1", receivedAt: new Date(now), status: "HEALTHY" },
      { id: "hb-2", receivedAt: new Date(now - 90_000), status: "HEALTHY" },
      { id: "hb-3", receivedAt: new Date(now - HEARTBEAT_RECOVERY_STABLE_SECONDS * 1000), status: "HEALTHY" }
    ]);
    prismaMock.alert.update.mockResolvedValue({});

    const result = await progressHeartbeatAlertRecovery("proj-1");
    expect(result.resolved).toBe(1);
    expect(result.recovering).toBe(0);
    expect(prismaMock.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "alert-rec" },
        data: expect.objectContaining({
          status: AlertStatus.RESOLVED,
          message: expect.stringContaining("remediationCausedRecovery=false")
        })
      })
    );
  });

  it("does not resolve when heartbeat count is below threshold", async () => {
    prismaMock.alert.findMany.mockResolvedValue([
      { id: "alert-open", status: AlertStatus.OPEN, message: "stale" }
    ]);
    prismaMock.heartbeat.findMany.mockResolvedValue([
      { id: "hb-1", receivedAt: new Date(), status: "HEALTHY" }
    ]);
    prismaMock.alert.update.mockResolvedValue({});

    const result = await progressHeartbeatAlertRecovery("proj-1");
    expect(result.resolved).toBe(0);
    expect(result.recovering).toBe(1);
  });
});
