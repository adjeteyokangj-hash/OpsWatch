import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  projectFindMany,
  projectUpdate,
  heartbeatFindFirst,
  heartbeatFindMany,
  alertFindFirst,
  alertFindMany,
  alertCreate,
  alertUpdate,
  deviceFindMany,
  deviceUpdate
} = vi.hoisted(() => ({
  projectFindMany: vi.fn(),
  projectUpdate: vi.fn(),
  heartbeatFindFirst: vi.fn(),
  heartbeatFindMany: vi.fn(),
  alertFindFirst: vi.fn(),
  alertFindMany: vi.fn(),
  alertCreate: vi.fn(),
  alertUpdate: vi.fn(),
  deviceFindMany: vi.fn(),
  deviceUpdate: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    project: { findMany: projectFindMany, update: projectUpdate },
    heartbeat: { findFirst: heartbeatFindFirst, findMany: heartbeatFindMany },
    alert: { findFirst: alertFindFirst, findMany: alertFindMany, create: alertCreate, update: alertUpdate },
    monitoredDevice: { findMany: deviceFindMany, update: deviceUpdate }
  }
}));

vi.mock("../services/notifications/notification.service", () => ({
  dispatchAlertNotifications: vi.fn()
}));

import { processHeartbeatStaleJob } from "./process-heartbeat-stale.job";

describe("processHeartbeatStaleJob device isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    alertFindMany.mockResolvedValue([]);
    heartbeatFindMany.mockResolvedValue([]);
    projectUpdate.mockResolvedValue({});
    deviceUpdate.mockResolvedValue({});
  });

  it("marks a quiet computer offline without an alert or a project change", async () => {
    const now = Date.now();
    deviceFindMany.mockResolvedValue([
      {
        id: "quiet",
        lastSeenAt: new Date(now - 11 * 60_000),
        offlineAfterSeconds: 600
      },
      {
        id: "live",
        lastSeenAt: new Date(now - 30_000),
        offlineAfterSeconds: 600
      }
    ]);
    projectFindMany.mockResolvedValue([
      { id: "project-1", slug: "niinai-guest-house", organizationId: "org-1" }
    ]);
    heartbeatFindFirst.mockResolvedValue(null);

    await processHeartbeatStaleJob();

    expect(deviceUpdate).toHaveBeenCalledTimes(1);
    expect(deviceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "quiet" },
        data: expect.objectContaining({ presence: "OFFLINE" })
      })
    );
    expect(heartbeatFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1", deviceId: null }
      })
    );
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(alertCreate).not.toHaveBeenCalled();
  });
});
