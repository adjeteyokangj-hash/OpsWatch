import { afterEach, describe, expect, it, vi } from "vitest";

const {
  update,
  auditCreate,
  ledgerCreate,
  transaction,
  serviceCreate,
  checkCreate,
  checkFindMany,
  checkUpdate
} = vi.hoisted(() => ({
  update: vi.fn(),
  auditCreate: vi.fn(),
  ledgerCreate: vi.fn(),
  transaction: vi.fn(),
  serviceCreate: vi.fn(),
  checkCreate: vi.fn(),
  checkFindMany: vi.fn(),
  checkUpdate: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    connection: { update },
    auditLog: { create: auditCreate },
    changeLedgerEntry: { create: ledgerCreate },
    deploymentRecord: { create: vi.fn() },
    $transaction: transaction
  }
}));

import {
  buildConnectionHeaders,
  discoverApiConnection,
  resolveConnectionSecretReference,
  testAgentlessConnection,
  testUnsavedConnection
} from "./agentless-connection.service";

const discoveryDocument = {
  schemaVersion: "1.0",
  application: { name: "StarLiz Academy", environment: "production", version: "1.0.0", instanceId: "i1" },
  monitoringMode: "api-discovered",
  capabilities: {
    health: true,
    services: true,
    database: true
  },
  endpoints: {
    health: "/api/external/v1/health",
    services: "/api/external/v1/services",
    database: "/api/external/v1/database"
  },
  registry: [
    { key: "health", enabled: true, endpoint: "/api/external/v1/health", requiredScope: "api:read", category: "core", description: "Health" },
    { key: "services", enabled: true, endpoint: "/api/external/v1/services", requiredScope: "api:read", category: "operations", description: "Services" },
    { key: "database", enabled: true, endpoint: "/api/external/v1/database", requiredScope: "api:read", category: "infrastructure", description: "Database" }
  ]
};

describe("agentless connection runner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("performs a real HTTP probe and stores its factual outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    update.mockResolvedValue({});
    auditCreate.mockResolvedValue({});
    ledgerCreate.mockResolvedValue({ id: "ledger-1" });

    const result = await testAgentlessConnection({
      id: "connection-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "Checkout health",
      mode: "AGENTLESS",
      configurationJson: { endpoint: "https://checkout.example.test/health", method: "GET", timeoutMs: 1000 },
      secretRef: null
    });

    expect(result).toMatchObject({ succeeded: true, statusCode: 204 });
    expect(fetch).toHaveBeenCalledWith("https://checkout.example.test/health", expect.objectContaining({ method: "GET" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ health: "HEALTHY" }) }));
    expect(ledgerCreate).toHaveBeenCalled();
  });

  it("resolves only explicit environment secret references", () => {
    process.env.OPSWATCH_TEST_WEBHOOK_SECRET = "test-secret";
    expect(resolveConnectionSecretReference("env://OPSWATCH_TEST_WEBHOOK_SECRET")).toBe("test-secret");
    expect(resolveConnectionSecretReference("vault://not-implemented")).toBeNull();
    delete process.env.OPSWATCH_TEST_WEBHOOK_SECRET;
  });

  it("sends the TrueNumeris credential as an Authorization Bearer header without returning it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await testUnsavedConnection({
      mode: "API",
      authMethod: "BEARER",
      configurationJson: {
        endpoint: "https://api.truenumeris.com/api/v1/health",
        authHeaderName: "Authorization",
        authPrefix: "Bearer",
        timeoutMs: 1000
      },
      authSecret: "top-secret"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.truenumeris.com/api/v1/health",
      expect.objectContaining({ headers: { Authorization: "Bearer top-secret" }, redirect: "manual" })
    );
    expect(JSON.stringify(result)).not.toContain("top-secret");
  });

  it("classifies authentication failures without exposing request headers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const result = await testUnsavedConnection({
      mode: "API",
      authMethod: "API_KEY",
      configurationJson: { endpoint: "https://example.test/health" },
      authSecret: "secret"
    });
    expect(result).toMatchObject({ succeeded: false, statusCode: 401, errorCategory: "AUTHENTICATION_FAILED" });
    expect(result).not.toHaveProperty("headers");
  });

  it("builds supported authentication headers", () => {
    expect(buildConnectionHeaders("BASIC", "user:pass", {})).toEqual({
      Authorization: `Basic ${Buffer.from("user:pass").toString("base64")}`
    });
    expect(buildConnectionHeaders("CUSTOM_HEADER", "value", { authHeaderName: "X-Custom" })).toEqual({ "X-Custom": "value" });
  });

  it("provisions monitoring only after a successful real probe", async () => {
    update.mockResolvedValue({});
    auditCreate.mockResolvedValue({});
    ledgerCreate.mockResolvedValue({ id: "ledger-2" });
    checkFindMany.mockResolvedValue([]);
    transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback({
      service: { findFirst: vi.fn(), create: serviceCreate.mockResolvedValue({ id: "service-1" }), update: vi.fn() },
      check: {
        findMany: checkFindMany,
        findFirst: vi.fn(),
        create: checkCreate.mockResolvedValue({ id: "check-1" }),
        update: checkUpdate
      },
      connection: { update: vi.fn() }
    }));
    const connection = {
      id: "connection-monitor",
      organizationId: "org-1",
      projectId: "project-1",
      name: "Monitored API",
      mode: "API",
      authMethod: "NONE",
      configurationJson: { endpoint: "https://example.test/health", timeoutMs: 1000 },
      secretRef: null,
      linkedServiceId: null,
      linkedCheckId: null
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })));
    await testAgentlessConnection(connection, { startMonitoring: true });
    expect(transaction).not.toHaveBeenCalled();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })));
    await testAgentlessConnection(connection, { startMonitoring: true });
    expect(serviceCreate).toHaveBeenCalled();
    expect(checkCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        expectedStatusCode: 204,
        isActive: true,
        configJson: expect.objectContaining({
          source: "CONNECTION",
          connectionId: "connection-monitor",
          capability: "health"
        })
      })
    }));
  });

  it("persists external discovery capabilities and rewrites the health endpoint", async () => {
    update.mockResolvedValue({});
    auditCreate.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(discoveryDocument), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })));

    const connection = {
      id: "connection-discover",
      organizationId: "org-1",
      projectId: "project-1",
      name: "StarLiz",
      mode: "API",
      authMethod: "BEARER",
      configurationJson: {
        endpoint: "https://starliz.example.test/api/external/v1/health",
        discoveryPath: "/api/external/v1/discovery",
        authHeaderName: "Authorization",
        authPrefix: "Bearer",
        timeoutMs: 1000
      },
      secretRef: "env://OPSWATCH_TEST_STARLIZ",
      linkedServiceId: null,
      linkedCheckId: null
    };
    process.env.OPSWATCH_TEST_STARLIZ = "starliz-secret";

    const result = await discoverApiConnection(connection);
    delete process.env.OPSWATCH_TEST_STARLIZ;

    expect(result).toMatchObject({
      statusCode: 200,
      schemaVersion: "1.0",
      monitoringMode: "api-discovered",
      endpoints: discoveryDocument.endpoints
    });
    expect(connection.configurationJson).toMatchObject({
      healthPath: "/api/external/v1/health",
      endpoint: "https://starliz.example.test/api/external/v1/health",
      discoveredEndpoints: discoveryDocument.endpoints
    });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        capabilitiesJson: expect.objectContaining({
          source: "external-discovery",
          monitoringMode: "api-discovered",
          capabilities: discoveryDocument.capabilities
        })
      })
    }));
  });

  it("auto-discovers then probes health and provisions advertised endpoint checks", async () => {
    update.mockResolvedValue({});
    auditCreate.mockResolvedValue({});
    ledgerCreate.mockResolvedValue({ id: "ledger-3" });
    checkFindMany.mockResolvedValue([]);
    let checkCounter = 0;
    checkCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      checkCounter += 1;
      return { id: `check-${checkCounter}`, ...data };
    });
    transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => callback({
      service: { findFirst: vi.fn(), create: serviceCreate.mockResolvedValue({ id: "service-disc" }), update: vi.fn() },
      check: {
        findMany: checkFindMany,
        create: checkCreate,
        update: checkUpdate
      },
      connection: { update: vi.fn() }
    }));

    const connection = {
      id: "connection-auto",
      organizationId: "org-1",
      projectId: "project-1",
      name: "StarLiz Auto",
      mode: "API",
      authMethod: "NONE",
      configurationJson: {
        endpoint: "https://starliz.example.test/",
        discoveryPath: "/api/external/v1/discovery",
        timeoutMs: 1000
      },
      secretRef: null,
      linkedServiceId: null,
      linkedCheckId: null
    };

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(discoveryDocument), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 })));

    const result = await testAgentlessConnection(connection, { startMonitoring: true });
    expect(result).toMatchObject({ succeeded: true, statusCode: 200 });
    const firstCallUrl = String((fetch as any).mock.calls[0][0]);
    expect(firstCallUrl).toContain("/api/external/v1/discovery");
    const secondCallUrl = String((fetch as any).mock.calls[1][0]);
    expect(secondCallUrl).toContain("/api/external/v1/health");
    expect(checkCreate).toHaveBeenCalledTimes(3);
    expect(checkCreate.mock.calls.map((call: any) => call[0].data.configJson.capability).sort()).toEqual([
      "database",
      "health",
      "services"
    ]);
  });
});
