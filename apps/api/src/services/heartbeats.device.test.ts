import { beforeEach, describe, expect, it, vi } from "vitest";

const { heartbeatCreate, projectUpdate, deviceUpsert, createAlert, serviceFindMany } = vi.hoisted(() => ({
  heartbeatCreate: vi.fn(),
  projectUpdate: vi.fn(),
  deviceUpsert: vi.fn(),
  createAlert: vi.fn(),
  serviceFindMany: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    heartbeat: { create: heartbeatCreate },
    project: { update: projectUpdate },
    service: { findMany: serviceFindMany },
    monitoredDevice: { upsert: deviceUpsert }
  }
}));

vi.mock("./alerting.service", () => ({ createAlert }));
vi.mock("./intelligence/observation.service", () => ({
  recordObservation: vi.fn(),
  recordOperationsTimelineEvent: vi.fn()
}));
vi.mock("./alert-automation-evaluation.service", () => ({
  progressHeartbeatAlertRecovery: vi.fn()
}));
vi.mock("./canonical-graph.service", () => ({
  canonicalGraph: { upsertEntity: vi.fn() }
}));
vi.mock("./evidence/signed-runtime-evidence.service", () => ({
  ingestSignedRuntimeEvidence: vi.fn()
}));

import { ingestHeartbeat } from "./heartbeats.service";

const DEVICE_A = "11111111-1111-4111-8111-111111111111";

describe("ingestHeartbeat device isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    heartbeatCreate.mockResolvedValue({});
    deviceUpsert.mockResolvedValue({});
    serviceFindMany.mockResolvedValue([]);
    projectUpdate.mockResolvedValue({
      id: "project-1",
      name: "NiiNai Guest House",
      organizationId: "org-1",
      environment: "production"
    });
  });

  it("stores one computer and does not change the project or open an alert", async () => {
    await ingestHeartbeat("project-1", {
      environment: "production",
      status: "DOWN",
      appVersion: "1.3.2",
      message: "sync failed",
      payload: {
        device: { id: DEVICE_A, label: "Kanewu Reception" },
        guestName: "Ama Mensah",
        sync: { financial: { pending: 0, failed: 2, oldestPendingAgeSeconds: 10 } }
      }
    });

    expect(deviceUpsert).toHaveBeenCalledOnce();
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(createAlert).not.toHaveBeenCalled();
    const stored = heartbeatCreate.mock.calls[0]?.[0].data;
    expect(stored.deviceId).toBe(DEVICE_A);
    expect(JSON.stringify(stored.payloadJson)).not.toContain("Ama");
    expect(stored.appVersion).toBe("1.3.2");
  });

  it("still updates project status for an application heartbeat", async () => {
    await ingestHeartbeat("project-1", {
      environment: "production",
      status: "HEALTHY",
      appVersion: "1.3.2",
      payload: { region: "accra" }
    });

    expect(deviceUpsert).not.toHaveBeenCalled();
    expect(projectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "HEALTHY" }
      })
    );
  });

  it("drops an invalid device heartbeat instead of applying it to the project", async () => {
    await ingestHeartbeat("project-1", {
      environment: "production",
      status: "DOWN",
      payload: { device: { id: "not-a-uuid" }, guestName: "Ama Mensah" }
    });

    expect(heartbeatCreate).not.toHaveBeenCalled();
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(createAlert).not.toHaveBeenCalled();
  });
});
