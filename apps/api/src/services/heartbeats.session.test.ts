import { beforeEach, describe, expect, it, vi } from "vitest";

const { heartbeatCreate, projectUpdate, deviceUpsert, sessionUpsert, createAlert } = vi.hoisted(() => ({
  heartbeatCreate: vi.fn(),
  projectUpdate: vi.fn(),
  deviceUpsert: vi.fn(),
  sessionUpsert: vi.fn(),
  createAlert: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    heartbeat: { create: heartbeatCreate },
    project: { update: projectUpdate },
    monitoredDevice: { upsert: deviceUpsert },
    monitoredSession: { upsert: sessionUpsert }
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

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const INSTALL = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TICKET = "f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1";

const body = (userId: string) => ({
  environment: "production",
  status: "HEALTHY",
  appVersion: "1.3.2",
  payload: {
    session: { id: SESSION, installationId: INSTALL, userId, ticket: TICKET },
    email: "person@example.com",
    amount: 901
  }
});

describe("ingestHeartbeat user sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    heartbeatCreate.mockResolvedValue({});
    sessionUpsert.mockResolvedValue({});
  });

  it("stores the verified user and does not change the project or the computer row", async () => {
    await ingestHeartbeat("project-1", body(USER), { verifiedUserId: USER });

    expect(sessionUpsert).toHaveBeenCalledOnce();
    expect(sessionUpsert.mock.calls[0]?.[0].create.userId).toBe(USER);
    expect(projectUpdate).not.toHaveBeenCalled();
    expect(deviceUpsert).not.toHaveBeenCalled();
    expect(createAlert).not.toHaveBeenCalled();
    const stored = JSON.stringify(heartbeatCreate.mock.calls[0]?.[0].data.payloadJson);
    expect(stored).not.toContain(TICKET);
    expect(stored).not.toContain("example.com");
    expect(stored).not.toContain("901");
  });

  it("does not store a session when the payload names a different user", async () => {
    await ingestHeartbeat("project-1", body(OTHER), { verifiedUserId: USER });
    expect(sessionUpsert).not.toHaveBeenCalled();
    expect(heartbeatCreate).not.toHaveBeenCalled();
  });

  it("does not store a session when no identity was verified", async () => {
    await ingestHeartbeat("project-1", body(USER));
    expect(sessionUpsert).not.toHaveBeenCalled();
  });
});
