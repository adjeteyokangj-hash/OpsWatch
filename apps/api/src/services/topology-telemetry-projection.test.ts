import { describe, expect, it } from "vitest";
import { DEVICE_OFFLINE_AFTER_SECONDS, presentMonitoredDevices } from "./device-heartbeat";
import type { ProjectTopologyResponse } from "../types/dto";
import { projectDeviceTelemetry } from "./topology-telemetry-projection";

const DEVICE = "11111111-1111-4111-8111-111111111111";

const base = (): ProjectTopologyResponse => ({
  project: { id: "proj-1", name: "Harbor Ledger", status: "UNKNOWN" },
  generatedAt: "2026-10-18T09:00:00.000Z",
  nodes: [
    {
      id: "svc-cloud",
      name: "Cloud reachability",
      type: "COMPONENT",
      status: "UNKNOWN",
      parentId: null,
      metrics: {
        availabilityPercent: null,
        latencyMs: null,
        errorRatePercent: null,
        sloBurnRate: null,
        availabilityTrend: []
      },
      risk: { openAlerts: 1, unresolvedIncidents: 0 }
    }
  ],
  edges: [],
  summary: {
    total: 1,
    healthy: 0,
    degraded: 0,
    critical: 0,
    unknown: 1,
    openAlerts: 1,
    openIncidents: 0
  },
  nodeContext: {
    "svc-cloud": {
      monitoringState: "AWAITING_FIRST_CHECK",
      lastCheckAt: null,
      lastCheckStatus: null,
      sloStatus: null,
      openAlerts: [],
      unresolvedIncidents: [],
      upstreamIds: [],
      downstreamIds: []
    }
  }
});

describe("projectDeviceTelemetry", () => {
  it("shows a computer and both sync lanes from a fresh heartbeat", () => {
    const now = new Date("2026-10-18T09:00:00.000Z");
    const [device] = presentMonitoredDevices(
      [
        {
          id: "row-1",
          deviceId: DEVICE,
          label: "Counter desk",
          appVersion: "2.0.1",
          lifecycleSync: "HEALTHY",
          financialSync: "DELAYED",
          failedCount: 0,
          pendingCount: 2,
          lastSeenAt: now,
          offlineAfterSeconds: DEVICE_OFFLINE_AFTER_SECONDS
        }
      ],
      now
    );

    const projected = projectDeviceTelemetry(base(), [device!]);
    const byName = new Map(projected.nodes.map((node) => [node.name, node]));

    expect(byName.get("Cloud reachability")).toBeTruthy();
    expect(byName.get("Counter desk")?.status).toBe("DEGRADED");
    expect(byName.get("Lifecycle synchronisation")?.status).toBe("HEALTHY");
    expect(byName.get("Financial synchronisation")?.status).toBe("DEGRADED");
    expect(byName.get("Lifecycle synchronisation")?.parentId).toBe(`installation:${DEVICE}`);
    expect(projected.summary.openAlerts).toBe(1);
    expect(projected.summary.openIncidents).toBe(0);
    expect(projected.edges.every((edge) => edge.provenance === "HEARTBEAT")).toBe(true);
  });

  it("marks a 22-hour-old heartbeat offline and does not treat it as a failure", () => {
    const now = new Date("2026-10-18T09:00:00.000Z");
    const [device] = presentMonitoredDevices(
      [
        {
          id: "row-1",
          deviceId: DEVICE,
          reportedName: "Front desk",
          appVersion: "1.3.2",
          lifecycleSync: "HEALTHY",
          financialSync: "HEALTHY",
          lastSeenAt: new Date(now.getTime() - 22 * 60 * 60 * 1000),
          offlineAfterSeconds: DEVICE_OFFLINE_AFTER_SECONDS
        }
      ],
      now
    );

    expect(device?.presence).toBe("OFFLINE");
    const projected = projectDeviceTelemetry(base(), [device!]);
    const computer = projected.nodes.find((node) => node.id === `installation:${DEVICE}`);
    const lanes = projected.nodes.filter((node) => node.type === "WORKFLOW");

    expect(computer?.status).toBe("UNKNOWN");
    expect(projected.nodeContext[computer!.id]?.lastCheckStatus).toContain("OFFLINE");
    expect(projected.nodeContext[computer!.id]?.lastCheckStatus).toContain("1.3.2");
    expect(lanes.map((lane) => lane.status)).toEqual(["UNKNOWN", "UNKNOWN"]);
    expect(computer?.risk.unresolvedIncidents).toBe(0);
    expect(projected.summary.openIncidents).toBe(0);
  });
});
