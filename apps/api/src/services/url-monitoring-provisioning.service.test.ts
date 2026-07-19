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

vi.mock("./entitlements/entitlement.service", () => ({
  getOrganizationEntitlements: vi.fn().mockResolvedValue({}),
  getMonitorEntitlementCapacityInTransaction: vi.fn()
}));

import {
  getMonitorEntitlementCapacityInTransaction
} from "./entitlements/entitlement.service";
import {
  provisionUrlMonitoring,
  reconcileProjectUrlMonitoring,
  UrlMonitorEntitlementError
} from "./url-monitoring-provisioning.service";

const checkFindMany = vi.fn();
const checkCount = vi.fn();
const checkUpdateMany = vi.fn();
const serviceUpdateMany = vi.fn();
const projectFind = vi.fn();
const projectUpdate = vi.fn();
const tx = {
  $queryRaw: vi.fn().mockResolvedValue([{ id: "org-1" }]),
  project: { findFirst: projectFind, update: projectUpdate },
  connection: { findFirst: connectionFind, create: connectionCreate, update: connectionUpdate },
  service: {
    findFirst: serviceFind,
    create: serviceCreate,
    update: serviceUpdate,
    updateMany: serviceUpdateMany
  },
  check: {
    findFirst: checkFind,
    findMany: checkFindMany,
    count: checkCount,
    create: checkCreate,
    update: checkUpdate,
    updateMany: checkUpdateMany
  }
};

describe("URL monitoring provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    tx.$queryRaw.mockResolvedValue([{ id: "org-1" }]);
    projectFind.mockResolvedValue({ id: "project-1" });
    projectUpdate.mockResolvedValue({});
    vi.mocked(getMonitorEntitlementCapacityInTransaction).mockResolvedValue({
      enabled: true,
      allowMutations: true,
      limit: 50,
      current: 0,
      available: 50
    });
    connectionFind.mockResolvedValue(null);
    connectionCreate.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: data.name === "Public website" ? "connection-public" : "connection-admin",
      linkedServiceId: null
    }));
    connectionUpdate.mockResolvedValue({});
    serviceFind.mockResolvedValue(null);
    serviceCreate.mockImplementation(async ({ data }: any) => ({
      id: data.name === "Public website" ? "service-public" : "service-admin"
    }));
    serviceUpdate.mockResolvedValue({});
    serviceUpdateMany.mockResolvedValue({ count: 1 });
    checkFindMany.mockResolvedValue([]);
    checkCount.mockResolvedValue(0);
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

  it("creates public plus admin URL monitoring when four monitors are available", async () => {
    const result = await reconcileProjectUrlMonitoring({
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Test application",
      environment: "testing",
      publicUrl: "https://example.com/",
      adminUrl: "https://admin.example.com/"
    });

    expect(result.public).toBeTruthy();
    expect(result.admin).toBeTruthy();
    expect(connectionCreate).toHaveBeenCalledTimes(2);
    expect(checkCreate).toHaveBeenCalledTimes(4);
  });

  it.each([
    { available: 1, publicUrl: "https://example.com/", adminUrl: undefined, required: 2 },
    { available: 3, publicUrl: "https://example.com/", adminUrl: "https://admin.example.com/", required: 4 }
  ])("rejects atomically when $required monitors are required but only $available are available", async ({
    available,
    publicUrl,
    adminUrl,
    required
  }) => {
    vi.mocked(getMonitorEntitlementCapacityInTransaction).mockResolvedValue({
      enabled: true,
      allowMutations: true,
      limit: available,
      current: 0,
      available
    });

    await expect(reconcileProjectUrlMonitoring({
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Test application",
      environment: "testing",
      publicUrl,
      ...(adminUrl ? { adminUrl } : {})
    })).rejects.toMatchObject<Partial<UrlMonitorEntitlementError>>({
      monitorsRequired: required,
      monitorsAvailable: available
    });
    expect(connectionCreate).not.toHaveBeenCalled();
    expect(serviceCreate).not.toHaveBeenCalled();
    expect(checkCreate).not.toHaveBeenCalled();
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
    checkFindMany.mockResolvedValue([
      { id: "http-check", type: "HTTP", name: "Public website availability", isActive: true },
      { id: "ssl-check", type: "SSL", name: "Public website certificate", isActive: true }
    ]);
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
    expect(getMonitorEntitlementCapacityInTransaction).toHaveBeenCalled();
    expect(result.httpCheckId).toBe("http-check");
    expect(result.sslCheckId).toBe("ssl-check");
  });

  it("rejects a project outside the organization before creating records", async () => {
    projectFind.mockResolvedValue(null);
    await expect(reconcileProjectUrlMonitoring({
      organizationId: "org-1",
      projectId: "project-other",
      projectName: "Other",
      environment: "testing",
      publicUrl: "https://example.com/"
    })).rejects.toThrow(/not in your organization/i);
    expect(connectionCreate).not.toHaveBeenCalled();
    expect(checkCreate).not.toHaveBeenCalled();
  });

  it("deactivates URL checks so they no longer consume active monitor usage", async () => {
    connectionFind.mockResolvedValue({
      id: "connection-public",
      linkedServiceId: "service-public",
      isActive: true
    });
    serviceFind.mockResolvedValue({ id: "service-public" });
    checkFindMany.mockResolvedValue([
      { id: "http-check", type: "HTTP", name: "Public website availability", isActive: true },
      { id: "ssl-check", type: "SSL", name: "Public website certificate", isActive: true }
    ]);

    await reconcileProjectUrlMonitoring({
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Test application",
      environment: "testing",
      publicUrl: null
    });

    expect(checkUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { serviceId: "service-public", isActive: true },
      data: expect.objectContaining({ isActive: false })
    }));
    expect(connectionUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ isActive: false, installationStatus: "DEACTIVATED" })
    }));
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
