import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  projectFindFirst,
  connectionFindMany,
  checkFindMany,
  heartbeatFindFirst,
  notificationChannelFindFirst,
  projectIntegrationFindMany,
  automationPlaybookVersionFindFirst,
  aiAutomationPolicyBundleFindUnique
} = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  connectionFindMany: vi.fn(),
  checkFindMany: vi.fn(),
  heartbeatFindFirst: vi.fn(),
  notificationChannelFindFirst: vi.fn(),
  projectIntegrationFindMany: vi.fn(),
  automationPlaybookVersionFindFirst: vi.fn(),
  aiAutomationPolicyBundleFindUnique: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    project: { findFirst: projectFindFirst },
    connection: { findMany: connectionFindMany },
    check: { findMany: checkFindMany },
    heartbeat: { findFirst: heartbeatFindFirst },
    notificationChannel: { findFirst: notificationChannelFindFirst },
    projectIntegration: { findMany: projectIntegrationFindMany },
    automationPlaybookVersion: { findFirst: automationPlaybookVersionFindFirst },
    aiAutomationPolicyBundle: { findUnique: aiAutomationPolicyBundleFindUnique }
  }
}));

vi.mock("../remediation/auto-run-policy.service", () => ({
  AUTO_RUN_ALLOWLIST: new Set(["RERUN_HTTP_CHECK"]),
  checkAutoRunPolicy: vi.fn(),
  getAutoRunPolicy: vi.fn(async () => ({
    enabled: true,
    allowlist: [{ action: "RERUN_HTTP_CHECK", autoRunEnabled: true }]
  }))
}));

import { assessAiLedReadiness } from "./enable-ai-led.service";
import { readinessStatusOk, readinessStatusLabel } from "./readiness-registry";

const ORG = "org-1";
const PROJECT = "proj-1";

const starlizCapabilities = {
  source: "external-discovery",
  schemaVersion: "1.0",
  monitoringMode: "api-discovered",
  capabilities: {
    health: true,
    services: true,
    database: true,
    jobs: true,
    integrations: true,
    deployments: true,
    version: true
  },
  endpoints: {
    health: "/api/external/v1/health",
    services: "/api/external/v1/services",
    deployments: "/api/external/v1/deployments"
  }
};

const baseMocks = () => {
  projectFindFirst.mockResolvedValue({
    id: PROJECT,
    name: "StarLiz Academy",
    slug: "starliz-academy",
    remediationEmergencyDisabled: false
  });
  heartbeatFindFirst.mockResolvedValue(null);
  notificationChannelFindFirst.mockResolvedValue({ id: "chan-1" });
  projectIntegrationFindMany.mockResolvedValue([
    { id: "int-1", type: "WORKER_PROVIDER", configJson: {} }
  ]);
  automationPlaybookVersionFindFirst.mockResolvedValue({ id: "pb-1" });
  aiAutomationPolicyBundleFindUnique.mockResolvedValue({
    operatingProfile: "AI_LED_SAFE",
    documentJson: {
      areas: { operatingProfile: { profile: "AI_LED_SAFE" } }
    }
  });
};

describe("readiness status helpers", () => {
  it("treats full, not_applicable, and disabled as ok", () => {
    expect(readinessStatusOk("full")).toBe(true);
    expect(readinessStatusOk("not_applicable")).toBe(true);
    expect(readinessStatusOk("disabled")).toBe(true);
    expect(readinessStatusOk("not_configured")).toBe(false);
  });

  it("exposes product labels without Partial", () => {
    expect(readinessStatusLabel("full")).toBe("Full");
    expect(readinessStatusLabel("not_configured")).toBe("Not configured");
    expect(readinessStatusLabel("not_applicable")).toBe("Not applicable");
    expect(readinessStatusLabel("disabled")).toBe("Disabled");
    expect(Object.values(["full", "not_configured", "not_applicable", "disabled"] as const).map(readinessStatusLabel)).not.toContain(
      "Partial"
    );
  });
});

describe("assessAiLedReadiness — api-discovered", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    baseMocks();
  });

  it("marks heartbeat not_applicable and can be ready without a heartbeat", async () => {
    connectionFindMany.mockResolvedValue([
      {
        id: "conn-1",
        mode: "API",
        installationStatus: "CONNECTED",
        health: "HEALTHY",
        capabilitiesJson: starlizCapabilities,
        configurationJson: { monitoringMode: "api-discovered" },
        linkedCheckId: "check-health"
      }
    ]);
    checkFindMany.mockResolvedValue([
      { id: "check-health", configJson: { capability: "health" }, recoveryThreshold: 1 },
      { id: "check-deploy", configJson: { capability: "deployments" }, recoveryThreshold: 1 }
    ]);

    const result = await assessAiLedReadiness(ORG, PROJECT);

    const heartbeat = result.items.find((item) => item.id === "recent-heartbeat");
    expect(heartbeat?.status).toBe("not_applicable");
    expect(heartbeat?.applicable).toBe(false);
    expect(heartbeat?.ok).toBe(true);
    expect(result.monitoringMode).toBe("api-discovered");
    expect(result.ready).toBe(true);
    expect(result.items.every((item) => !item.applicable || item.ok)).toBe(true);
  });

  it("fails ready when health is advertised but not configured", async () => {
    connectionFindMany.mockResolvedValue([
      {
        id: "conn-1",
        mode: "API",
        installationStatus: "CONNECTED",
        health: "HEALTHY",
        capabilitiesJson: starlizCapabilities,
        configurationJson: { monitoringMode: "api-discovered" },
        linkedCheckId: null
      }
    ]);
    checkFindMany.mockResolvedValue([]);

    const result = await assessAiLedReadiness(ORG, PROJECT);

    const health = result.items.find((item) => item.id === "health-configured");
    expect(health?.status).toBe("not_configured");
    expect(health?.applicable).toBe(true);
    expect(health?.ok).toBe(false);
    expect(health?.href).toBe(`/projects/${PROJECT}/checks`);
    expect(result.ready).toBe(false);
  });

  it("marks health not_applicable when capability is not advertised", async () => {
    connectionFindMany.mockResolvedValue([
      {
        id: "conn-1",
        mode: "API",
        installationStatus: "CONNECTED",
        health: "HEALTHY",
        capabilitiesJson: {
          ...starlizCapabilities,
          capabilities: { services: true },
          endpoints: { services: "/api/external/v1/services" }
        },
        configurationJson: { monitoringMode: "api-discovered" },
        linkedCheckId: null
      }
    ]);
    checkFindMany.mockResolvedValue([
      { id: "check-services", configJson: { capability: "services" }, recoveryThreshold: 1 }
    ]);

    const result = await assessAiLedReadiness(ORG, PROJECT);
    const health = result.items.find((item) => item.id === "health-configured");
    expect(health?.status).toBe("not_applicable");
    expect(health?.ok).toBe(true);
  });

  it("does not let not_applicable or disabled-style items fail ready", async () => {
    connectionFindMany.mockResolvedValue([
      {
        id: "conn-1",
        mode: "API",
        installationStatus: "CONNECTED",
        health: "HEALTHY",
        capabilitiesJson: {
          ...starlizCapabilities,
          capabilities: { health: true },
          endpoints: { health: "/api/external/v1/health" }
        },
        configurationJson: { monitoringMode: "api-discovered" },
        linkedCheckId: "check-health"
      }
    ]);
    checkFindMany.mockResolvedValue([
      { id: "check-health", configJson: { capability: "health" }, recoveryThreshold: 1 }
    ]);
    // Monitor-only profile → remediator/playbook/auto-run become not_applicable when absent
    aiAutomationPolicyBundleFindUnique.mockResolvedValue({
      operatingProfile: "MONITOR_ONLY",
      documentJson: {
        areas: { operatingProfile: { profile: "MONITOR_ONLY" } }
      }
    });
    projectIntegrationFindMany.mockResolvedValue([]);
    automationPlaybookVersionFindFirst.mockResolvedValue(null);
    vi.mocked(
      await import("../remediation/auto-run-policy.service")
    ).getAutoRunPolicy.mockResolvedValueOnce({
      enabled: false,
      allowlist: []
    } as never);

    const result = await assessAiLedReadiness(ORG, PROJECT);
    const remediator = result.items.find((item) => item.id === "remediator-integration");
    const playbook = result.items.find((item) => item.id === "approved-playbook");
    const autoRun = result.items.find((item) => item.id === "auto-run-approvals");
    expect(remediator?.status).toBe("not_applicable");
    expect(playbook?.status).toBe("not_applicable");
    expect(autoRun?.status).toBe("not_applicable");
    expect(result.ready).toBe(true);
  });
});

describe("assessAiLedReadiness — heartbeat mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    baseMocks();
  });

  it("keeps heartbeat applicable and blocks when missing", async () => {
    connectionFindMany.mockResolvedValue([
      {
        id: "conn-hb",
        mode: "HEARTBEAT",
        installationStatus: "CONNECTED",
        health: "HEALTHY",
        capabilitiesJson: null,
        configurationJson: {},
        linkedCheckId: null
      }
    ]);
    checkFindMany.mockResolvedValue([{ id: "check-1", configJson: {}, recoveryThreshold: 1 }]);
    heartbeatFindFirst.mockResolvedValue(null);

    const result = await assessAiLedReadiness(ORG, PROJECT);
    const heartbeat = result.items.find((item) => item.id === "recent-heartbeat");
    expect(heartbeat?.status).toBe("not_configured");
    expect(heartbeat?.applicable).toBe(true);
    expect(result.ready).toBe(false);
  });
});
