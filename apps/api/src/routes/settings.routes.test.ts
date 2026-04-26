import express from "express";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockProjectFindFirst,
  mockNotificationFindMany,
  mockNotificationCreate,
  mockNotificationFindFirst,
  mockNotificationUpdate,
  mockNotificationDeleteMany,
  mockIntegrationFindMany,
  mockIntegrationUpsert,
  mockIntegrationFindFirst,
  mockIntegrationUpdate
} = vi.hoisted(() => ({
  mockProjectFindFirst: vi.fn(),
  mockNotificationFindMany: vi.fn(),
  mockNotificationCreate: vi.fn(),
  mockNotificationFindFirst: vi.fn(),
  mockNotificationUpdate: vi.fn(),
  mockNotificationDeleteMany: vi.fn(),
  mockIntegrationFindMany: vi.fn(),
  mockIntegrationUpsert: vi.fn(),
  mockIntegrationFindFirst: vi.fn(),
  mockIntegrationUpdate: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    project: {
      findFirst: mockProjectFindFirst
    },
    notificationChannel: {
      findMany: mockNotificationFindMany,
      create: mockNotificationCreate,
      findFirst: mockNotificationFindFirst,
      update: mockNotificationUpdate,
      deleteMany: mockNotificationDeleteMany
    },
    projectIntegration: {
      findMany: mockIntegrationFindMany,
      upsert: mockIntegrationUpsert,
      findFirst: mockIntegrationFindFirst,
      update: mockIntegrationUpdate
    }
  }
}));

import { settingsRouter } from "./settings.routes";

const orgUser = { id: "u1", role: "ADMIN", organizationId: "org-1" };

const request = async (
  method: string,
  path: string,
  body?: unknown,
  user: Record<string, unknown> | undefined = orgUser
) => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = user;
    next();
  });
  app.use(settingsRouter);

  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } finally {
    server.close();
  }
};

describe("settings.routes tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectFindFirst.mockResolvedValue({ id: "proj-1" });
    mockNotificationFindMany.mockResolvedValue([]);
    mockNotificationCreate.mockResolvedValue({ id: "chan-1" });
    mockNotificationFindFirst.mockResolvedValue({ id: "chan-1" });
    mockNotificationUpdate.mockResolvedValue({ id: "chan-1" });
    mockNotificationDeleteMany.mockResolvedValue({ count: 1 });
    mockIntegrationFindMany.mockResolvedValue([]);
    mockIntegrationUpsert.mockResolvedValue({ id: "int-1" });
    mockIntegrationFindFirst.mockResolvedValue({
      id: "int-1",
      type: "WEBHOOK",
      enabled: true,
      configJson: {}
    });
    mockIntegrationUpdate.mockResolvedValue({ id: "int-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires an organization for settings resources", async () => {
    const response = await request("GET", "/settings/notifications", undefined, { id: "u1", role: "ADMIN" });

    expect(response.status).toBe(403);
    expect(mockNotificationFindMany).not.toHaveBeenCalled();
  });

  it("scopes notification listing by project organization", async () => {
    const response = await request("GET", "/settings/notifications");

    expect(response.status).toBe(200);
    expect(mockNotificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { project: { organizationId: "org-1" } }
      })
    );
  });

  it("rejects unscoped notification channel creation", async () => {
    const response = await request("POST", "/settings/notifications", {
      projectId: null,
      type: "WEBHOOK",
      name: "Webhook",
      target: "https://example.com/hook"
    });

    expect(response.status).toBe(400);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it("rejects notification channel creation for a foreign project", async () => {
    mockProjectFindFirst.mockResolvedValue(null);

    const response = await request("POST", "/settings/notifications", {
      projectId: "9e041215-ec08-4623-8bb8-c17db810f703",
      type: "WEBHOOK",
      name: "Webhook",
      target: "https://example.com/hook"
    });

    expect(response.status).toBe(404);
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it("scopes integration listing by project organization", async () => {
    const response = await request("GET", "/settings/integrations?projectId=proj-1");

    expect(response.status).toBe(200);
    expect(mockIntegrationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "proj-1",
          project: { organizationId: "org-1" }
        }
      })
    );
  });

  it("rejects integration upsert for a foreign project", async () => {
    mockProjectFindFirst.mockResolvedValue(null);

    const response = await request("PUT", "/settings/integrations/9e041215-ec08-4623-8bb8-c17db810f703/WEBHOOK", {
      name: "Webhook",
      enabled: true
    });

    expect(response.status).toBe(404);
    expect(mockIntegrationUpsert).not.toHaveBeenCalled();
  });

  it("scopes integration validation by project organization", async () => {
    const response = await request("POST", "/settings/integrations/9e041215-ec08-4623-8bb8-c17db810f703/WEBHOOK/validate");

    expect(response.status).toBe(200);
    expect(mockIntegrationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: "9e041215-ec08-4623-8bb8-c17db810f703",
          type: "WEBHOOK",
          project: { organizationId: "org-1" }
        }
      })
    );
  });
});
