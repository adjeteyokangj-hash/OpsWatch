import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  transaction,
  connectionFind,
  connectionCreate,
  connectionUpdate,
  serviceFind,
  serviceCreate,
  serviceUpdate,
  checkFind,
  checkCreate,
  checkUpdate
} = vi.hoisted(() => ({
  transaction: vi.fn(),
  connectionFind: vi.fn(),
  connectionCreate: vi.fn(),
  connectionUpdate: vi.fn(),
  serviceFind: vi.fn(),
  serviceCreate: vi.fn(),
  serviceUpdate: vi.fn(),
  checkFind: vi.fn(),
  checkCreate: vi.fn(),
  checkUpdate: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: { $transaction: transaction }
}));

vi.mock("./agentless-connection.service", () => ({
  assertSafeConnectionTarget: vi.fn().mockResolvedValue(undefined)
}));

import { provisionUrlMonitoring } from "./url-monitoring-provisioning.service";

const tx = {
  connection: { findFirst: connectionFind, create: connectionCreate, update: connectionUpdate },
  service: { findFirst: serviceFind, create: serviceCreate, update: serviceUpdate },
  check: { findFirst: checkFind, create: checkCreate, update: checkUpdate }
};

describe("URL monitoring provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    connectionFind.mockResolvedValue(null);
    connectionCreate.mockResolvedValue({
      id: "connection-public",
      linkedServiceId: null
    });
    connectionUpdate.mockResolvedValue({});
    serviceFind.mockResolvedValue(null);
    serviceCreate.mockResolvedValue({ id: "service-public" });
    serviceUpdate.mockResolvedValue({});
    checkFind.mockResolvedValue(null);
    checkCreate
      .mockResolvedValueOnce({ id: "http-check" })
      .mockResolvedValueOnce({ id: "ssl-check" });
    checkUpdate.mockResolvedValue({});
  });

  it("creates a persistent connection plus HTTP and SSL checks", async () => {
    const result = await provisionUrlMonitoring({
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Test application",
      environment: "testing",
      role: "PUBLIC",
      url: "https://example.com"
    });

    expect(connectionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        projectId: "project-1",
        name: "Public website",
        installationStatus: "SCHEDULED"
      })
    }));
    expect(checkCreate).toHaveBeenCalledTimes(2);
    expect(checkCreate).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ type: "HTTP", isActive: true })
    }));
    expect(checkCreate).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ type: "SSL", isActive: true })
    }));
    expect(result).toMatchObject({
      connectionId: "connection-public",
      serviceId: "service-public"
    });
  });

  it("reuses existing records on registration retry", async () => {
    connectionFind.mockResolvedValue({
      id: "connection-public",
      linkedServiceId: "service-public"
    });
    connectionUpdate.mockResolvedValue({
      id: "connection-public",
      linkedServiceId: "service-public"
    });
    serviceFind.mockResolvedValue({ id: "service-public" });
    checkFind
      .mockResolvedValueOnce({ id: "http-check" })
      .mockResolvedValueOnce({ id: "ssl-check" });

    const result = await provisionUrlMonitoring({
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Test application",
      environment: "testing",
      role: "PUBLIC",
      url: "https://example.com"
    });

    expect(connectionCreate).not.toHaveBeenCalled();
    expect(serviceCreate).not.toHaveBeenCalled();
    expect(checkCreate).not.toHaveBeenCalled();
    expect(checkUpdate).toHaveBeenCalledTimes(2);
    expect(result.httpCheckId).toBe("http-check");
    expect(result.sslCheckId).toBe("ssl-check");
  });

  it("creates an isolated admin connection and checks", async () => {
    await provisionUrlMonitoring({
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Test application",
      environment: "testing",
      role: "ADMIN",
      url: "https://admin.example.com"
    });

    expect(connectionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        name: "Admin endpoint",
        authMethod: "NONE"
      })
    }));
    expect(checkCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        configJson: expect.objectContaining({ monitoringRole: "ADMIN" })
      })
    }));
  });
});
