import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  checkFindMany,
  resultCreate,
  resultFindMany,
  alertFindFirst,
  alertFindMany,
  alertCreate,
  alertUpdate,
  connectionFind,
  connectionUpdateMany,
  serviceUpdate,
  notify
} = vi.hoisted(() => ({
  checkFindMany: vi.fn(),
  resultCreate: vi.fn(),
  resultFindMany: vi.fn(),
  alertFindFirst: vi.fn(),
  alertFindMany: vi.fn(),
  alertCreate: vi.fn(),
  alertUpdate: vi.fn(),
  connectionFind: vi.fn(),
  connectionUpdateMany: vi.fn(),
  serviceUpdate: vi.fn(),
  notify: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    check: { findMany: checkFindMany },
    checkResult: { create: resultCreate, findMany: resultFindMany },
    alert: {
      findFirst: alertFindFirst,
      findMany: alertFindMany,
      create: alertCreate,
      update: alertUpdate
    },
    connection: { findFirst: connectionFind, updateMany: connectionUpdateMany },
    service: { update: serviceUpdate }
  }
}));

vi.mock("../lib/outbound-url-safety", () => ({
  resolveSafeOutboundTarget: vi.fn(async (target: string) => ({
    url: new URL(target),
    addresses: ["203.0.113.1"]
  }))
}));

vi.mock("../services/notifications/notification.service", () => ({
  dispatchAlertNotifications: notify
}));

import { runHttpChecksJob } from "./run-http-checks.job";

const generatedCheck = {
  id: "check-http",
  serviceId: "service-public",
  name: "Public website availability",
  type: "HTTP",
  intervalSeconds: 60,
  timeoutMs: 1000,
  expectedStatusCode: 200,
  expectedKeyword: null,
  failureThreshold: 3,
  recoveryThreshold: 2,
  configJson: {
    source: "URL_ONBOARDING",
    connectionId: "connection-public",
    monitoringRole: "PUBLIC",
    acceptedStatusMin: 200,
    acceptedStatusMax: 399
  },
  isActive: true,
  Service: {
    id: "service-public",
    projectId: "project-1",
    baseUrl: "https://example.test",
    Project: { id: "project-1", organizationId: "org-1" }
  }
};

describe("generated URL HTTP checks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkFindMany.mockResolvedValue([generatedCheck]);
    resultCreate.mockResolvedValue({});
    alertFindFirst.mockResolvedValue(null);
    alertFindMany.mockResolvedValue([]);
    alertCreate.mockResolvedValue({ id: "alert-1" });
    alertUpdate.mockResolvedValue({});
    connectionFind.mockResolvedValue({
      id: "connection-public",
      authMethod: "NONE",
      secretRef: null,
      managedSecretCiphertext: null,
      managedSecretIv: null,
      managedSecretAuthTag: null,
      configurationJson: generatedCheck.configJson
    });
    connectionUpdateMany.mockResolvedValue({ count: 1 });
    serviceUpdate.mockResolvedValue({});
  });

  it("accepts a safe redirect and marks monitoring connected", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: "https://www.example.test/" }
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 })));
    resultFindMany.mockResolvedValue([
      { status: "PASS" },
      { status: "PASS" }
    ]);

    await runHttpChecksJob();

    expect(resultCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "PASS",
        responseCode: 200,
        rawJson: expect.objectContaining({
          finalUrl: "https://www.example.test/",
          redirects: ["https://www.example.test/"]
        })
      })
    }));
    expect(connectionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        health: "HEALTHY",
        installationStatus: "CONNECTED"
      })
    }));
  });

  it("fails safely when a redirect loop is detected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://example.test" }
    })));
    resultFindMany.mockResolvedValue([{ status: "FAIL" }]);

    await runHttpChecksJob();

    expect(resultCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "FAIL",
        message: expect.stringMatching(/redirect loop/i)
      })
    }));
  });

  it("creates an alert after the configured failure threshold", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    resultFindMany.mockResolvedValue([
      { status: "FAIL" },
      { status: "FAIL" },
      { status: "FAIL" }
    ]);

    await runHttpChecksJob();

    expect(alertCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceId: "check-http",
        category: "AVAILABILITY"
      })
    }));
    expect(connectionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ health: "DEGRADED", installationStatus: "ERROR" })
    }));
  });

  it("resolves the alert only after consecutive recovery results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    resultFindMany.mockResolvedValue([
      { status: "PASS" },
      { status: "PASS" }
    ]);
    alertFindMany.mockResolvedValue([{ id: "alert-open" }]);

    await runHttpChecksJob();

    expect(alertUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "alert-open" },
      data: expect.objectContaining({ status: "RESOLVED" })
    }));
    expect(notify).toHaveBeenCalledWith("alert-open", "resolved");
  });
});
