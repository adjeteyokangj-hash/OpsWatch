import { describe, expect, it } from "vitest";
import {
  projectHasRemediationCapability,
  remediatingEdgeIdsFromRuns,
  topologyReturnPath
} from "./topology-automation-link";
import type { ProjectIntegration } from "../../lib/integrations";
import type { ProjectTopologyResponse } from "./topology-types";

const baseIntegration = (overrides: Partial<ProjectIntegration>): ProjectIntegration => ({
  id: "int-1",
  projectId: "proj-1",
  type: "WORKER_PROVIDER",
  name: "Workers",
  enabled: true,
  configJson: { WORKER_RESTART_WEBHOOK_URL: "https://example.com/restart" },
  secretRef: null,
  validationStatus: "VALID",
  validationMessage: null,
  lastValidatedAt: "2026-07-15T10:00:00.000Z",
  ...overrides
});

describe("projectHasRemediationCapability", () => {
  it("requires a connected remediator integration on the project", () => {
    expect(projectHasRemediationCapability([], "proj-1")).toBe(false);
    expect(
      projectHasRemediationCapability(
        [baseIntegration({ validationStatus: "UNKNOWN" })],
        "proj-1"
      )
    ).toBe(false);
    expect(projectHasRemediationCapability([baseIntegration({})], "proj-1")).toBe(true);
    expect(projectHasRemediationCapability([baseIntegration({})], "other")).toBe(false);
  });

  it("rejects monitoring-only and incompatible capabilities", () => {
    expect(
      projectHasRemediationCapability(
        [baseIntegration({ type: "WEBHOOK" as never })],
        "proj-1"
      )
    ).toBe(false);
    expect(
      projectHasRemediationCapability(
        [
          baseIntegration({
            configJson: {
              WORKER_RESTART_WEBHOOK_URL: "https://example.com/restart",
              REMEDIATOR_CAPABILITIES: "retry_failed_jobs"
            }
          })
        ],
        "proj-1",
        "restart_sync_worker"
      )
    ).toBe(false);
  });
});

describe("remediatingEdgeIdsFromRuns", () => {
  const topology = {
    project: { id: "proj-1", name: "Demo", status: "DEGRADED" },
    generatedAt: new Date().toISOString(),
    nodes: [],
    edges: [
      {
        id: "e1",
        sourceId: "svc-a",
        targetId: "svc-b",
        type: "DEPENDENCY",
        critical: false,
        status: "CRITICAL"
      },
      {
        id: "h1",
        sourceId: "mod",
        targetId: "svc-a",
        type: "HIERARCHY",
        critical: false,
        status: "UNKNOWN"
      }
    ],
    summary: {
      total: 0,
      healthy: 0,
      degraded: 0,
      critical: 0,
      unknown: 0,
      openAlerts: 0,
      openIncidents: 0
    },
    nodeContext: {}
  } as ProjectTopologyResponse;

  it("maps active run service ids onto dependency edges only", () => {
    const ids = remediatingEdgeIdsFromRuns(topology, [
      {
        id: "run-1",
        incidentId: "inc-1",
        status: "VERIFYING",
        affectedServiceIds: ["svc-b"],
        targetServiceIds: []
      }
    ]);
    expect([...ids]).toEqual(["e1"]);
  });
});

describe("topologyReturnPath", () => {
  it("embeds edgeId for deep-link restore", () => {
    expect(topologyReturnPath("proj-1")).toBe("/projects/proj-1/topology");
    expect(topologyReturnPath("proj-1", "edge-9")).toBe(
      "/projects/proj-1/topology?edgeId=edge-9"
    );
  });
});
