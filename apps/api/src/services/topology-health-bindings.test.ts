import { describe, expect, it } from "vitest";
import { DEVICE_OFFLINE_AFTER_SECONDS, presentMonitoredDevices } from "./device-heartbeat";
import type { ProjectTopologyResponse } from "../types/dto";
import { applyDeclaredHealth } from "./topology-health-bindings";
import { projectDeviceTelemetry } from "./topology-telemetry-projection";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const KANEWU = "10000000-0000-4000-8000-000000000001";

const node = (id: string, name: string, kind: string) => ({
  id,
  name,
  type: kind === "application"
    ? "APP" as const
    : kind === "workflow"
      ? "WORKFLOW" as const
      : kind === "module"
        ? "MODULE" as const
        : "COMPONENT" as const,
  status: "UNKNOWN" as const,
  parentId: null,
  kind,
  metrics: {
    availabilityPercent: null,
    latencyMs: null,
    errorRatePercent: null,
    sloBurnRate: null,
    availabilityTrend: [] as number[]
  },
  risk: { openAlerts: 0, unresolvedIncidents: 0 }
});

const manifest = (
  kind: string,
  binding: { signal: "heartbeat_lane" | "unbound" | "http_check"; lane?: "lifecycle" | "financial" | null; checkName?: string | null } | null,
  externalId: string | null = null
) => ({
  kind,
  category: null,
  externalId,
  healthBinding: binding
    ? { signal: binding.signal, lane: binding.lane ?? null, checkName: binding.checkName ?? null }
    : null,
  evidence: "missing" as const,
  lastSuccessAt: null,
  lastFailureAt: null,
  computers: [],
  potentialImpact: []
});

const topology = (): ProjectTopologyResponse => ({
  project: { id: "proj", name: "Harbor", status: "UNKNOWN" },
  generatedAt: "2026-10-18T09:00:00.000Z",
  nodes: [
    node("payments", "Payments", "module"),
    node("financial", "Financial synchronisation", "workflow"),
    node("kanewu", "Kanewu", "property"),
    node("community", "Community 25", "property"),
    node("app", "Harbor", "application")
  ],
  edges: [
    {
      id: "sync-payments",
      sourceId: "financial",
      targetId: "payments",
      type: "DEPENDENCY",
      relationshipType: "SYNCS",
      critical: true,
      status: "UNKNOWN"
    }
  ],
  summary: { total: 5, healthy: 0, degraded: 0, critical: 0, unknown: 5, openAlerts: 0, openIncidents: 0 },
  nodeContext: {
    payments: {
      monitoringState: "AWAITING_FIRST_CHECK",
      lastCheckAt: null,
      lastCheckStatus: null,
      sloStatus: null,
      openAlerts: [],
      unresolvedIncidents: [],
      upstreamIds: [],
      downstreamIds: [],
      manifest: manifest("module", { signal: "unbound" })
    },
    financial: {
      monitoringState: "AWAITING_FIRST_CHECK",
      lastCheckAt: null,
      lastCheckStatus: null,
      sloStatus: null,
      openAlerts: [],
      unresolvedIncidents: [],
      upstreamIds: [],
      downstreamIds: [],
      manifest: manifest("workflow", { signal: "heartbeat_lane", lane: "financial" })
    },
    kanewu: {
      monitoringState: "AWAITING_FIRST_CHECK",
      lastCheckAt: null,
      lastCheckStatus: null,
      sloStatus: null,
      openAlerts: [],
      unresolvedIncidents: [],
      upstreamIds: [],
      downstreamIds: [],
      manifest: manifest("property", null, KANEWU)
    },
    community: {
      monitoringState: "AWAITING_FIRST_CHECK",
      lastCheckAt: null,
      lastCheckStatus: null,
      sloStatus: null,
      openAlerts: [],
      unresolvedIncidents: [],
      upstreamIds: [],
      downstreamIds: [],
      manifest: manifest("property", null, null)
    },
    app: {
      monitoringState: "AWAITING_FIRST_CHECK",
      lastCheckAt: null,
      lastCheckStatus: null,
      sloStatus: null,
      openAlerts: [],
      unresolvedIncidents: [],
      upstreamIds: [],
      downstreamIds: [],
      manifest: manifest("application", null)
    }
  }
});

describe("applyDeclaredHealth", () => {
  const now = new Date("2026-10-18T09:00:00.000Z");
  const [device] = presentMonitoredDevices(
    [{
      id: "row",
      deviceId: DEVICE,
      label: "Front desk",
      propertyId: KANEWU,
      appVersion: "1.3.3",
      lifecycleSync: "HEALTHY",
      financialSync: "FAILED",
      lastSeenAt: now,
      offlineAfterSeconds: DEVICE_OFFLINE_AFTER_SECONDS
    }],
    now
  );

  it("paints the bound sync lane and leaves unbound modules grey", () => {
    const placed = projectDeviceTelemetry(topology(), [device!]);
    const result = applyDeclaredHealth(placed, [device!]);
    const financial = result.nodes.find((node) => node.id === "financial");
    const payments = result.nodes.find((node) => node.id === "payments");
    const computer = result.nodes.find((node) => node.id === `installation:${DEVICE}`);

    expect(financial?.status).toBe("CRITICAL");
    expect(payments?.status).toBe("UNKNOWN");
    expect(result.nodeContext.payments?.manifest?.evidence).toBe("missing");
    expect(result.nodeContext.payments?.manifest?.potentialImpact.map((item) => item.name)).toEqual([
      "Financial synchronisation"
    ]);
    expect(computer?.parentId).toBe("kanewu");
    expect(computer?.status).toBe("HEALTHY");
    expect(result.summary.openIncidents).toBe(0);
  });

  it("does not assign a computer to a property without a matching identifier", () => {
    const [unmatched] = presentMonitoredDevices(
      [{
        id: "row-2",
        deviceId: "22222222-2222-4222-8222-222222222222",
        label: "Other desk",
        propertyId: "33333333-3333-4333-8333-333333333333",
        lifecycleSync: "HEALTHY",
        financialSync: "HEALTHY",
        lastSeenAt: now,
        offlineAfterSeconds: DEVICE_OFFLINE_AFTER_SECONDS
      }],
      now
    );
    const placed = projectDeviceTelemetry(topology(), [unmatched!]);
    const computer = placed.nodes.find((node) => node.name === "Other desk");
    expect(computer?.parentId).toBe("app");
    expect(computer?.parentId).not.toBe("community");
  });

  it("keeps a lane grey when every computer is offline and paints an http check only by name", () => {
    const staleAt = new Date("2026-10-17T00:00:00.000Z");
    const [offline] = presentMonitoredDevices(
      [{
        id: "row-3",
        deviceId: "44444444-4444-4444-8444-444444444444",
        label: "Closed desk",
        lifecycleSync: "FAILED",
        financialSync: "FAILED",
        lastSeenAt: staleAt,
        offlineAfterSeconds: DEVICE_OFFLINE_AFTER_SECONDS
      }],
      new Date("2026-10-18T09:00:00.000Z")
    );
    const source = topology();
    source.nodeContext.financial!.manifest!.healthBinding = {
      signal: "http_check",
      lane: null,
      checkName: "Ledger health"
    };
    const painted = applyDeclaredHealth(projectDeviceTelemetry(source, [offline!]), [offline!], [
      { name: "Ledger health", status: "WARN", checkedAt: "2026-10-18T08:00:00.000Z" },
      { name: "Something else", status: "FAIL", checkedAt: "2026-10-18T08:00:00.000Z" }
    ]);
    expect(painted.nodes.find((node) => node.id === "financial")?.status).toBe("DEGRADED");
    expect(painted.nodes.find((node) => node.name === "Closed desk")?.status).toBe("UNKNOWN");
    expect(painted.summary.openIncidents).toBe(0);
  });
});
