import { describe, expect, it } from "vitest";
import {
  buildAffectedNodeIds,
  buildIncidentCausalGraphResponse,
  buildPropagationOverlays,
  buildRootCauseOverlays,
  classifyAnalysisEvidence,
  mapChangeEventType
} from "./incident-causal-graph.service";
import type { ProjectTopologyResponse } from "../types/dto";
import type { DeepDiagnosisResult } from "./ai/incident-analysis.service";

const topology: ProjectTopologyResponse = {
  project: { id: "proj-1", name: "Noble Express", status: "DEGRADED" },
  generatedAt: new Date().toISOString(),
  nodes: [
    {
      id: "app",
      name: "Noble Express",
      type: "APP",
      status: "DEGRADED",
      parentId: null,
      metrics: { availabilityPercent: null, latencyMs: null, errorRatePercent: null, sloBurnRate: null },
      risk: { openAlerts: 0, unresolvedIncidents: 1 }
    },
    {
      id: "redis",
      name: "Redis",
      type: "COMPONENT",
      status: "CRITICAL",
      parentId: null,
      metrics: { availabilityPercent: null, latencyMs: null, errorRatePercent: null, sloBurnRate: null },
      risk: { openAlerts: 1, unresolvedIncidents: 0 }
    },
    {
      id: "quote-api",
      name: "Quote API",
      type: "COMPONENT",
      status: "DEGRADED",
      parentId: null,
      metrics: { availabilityPercent: null, latencyMs: null, errorRatePercent: null, sloBurnRate: null },
      risk: { openAlerts: 1, unresolvedIncidents: 1 }
    }
  ],
  edges: [],
  summary: {
    total: 3,
    healthy: 0,
    degraded: 2,
    critical: 1,
    unknown: 0,
    openAlerts: 2,
    openIncidents: 1
  },
  nodeContext: {}
};

const diagnosis = {
  diagnosis: "Redis outage is cascading into quote workflows.",
  confidence: 0.88,
  analysisMode: "CORRELATION",
  rootCauseHypothesis: "Redis is the upstream root cause.",
  evidence: [{ type: "ALERT", summary: "Redis unreachable", weight: 0.2 }],
  topCandidates: [],
  suggestedActions: [],
  category: "RELIABILITY",
  dependencyImpact: {
    probableRootCause: {
      serviceId: "redis",
      serviceName: "Redis",
      layer: "COMPONENT",
      rationale: "Redis is the deepest failing dependency."
    },
    propagationChain: [
      {
        fromServiceId: "quote-api",
        fromServiceName: "Quote API",
        toServiceId: "redis",
        toServiceName: "Redis",
        relationship: "Quote API depends on Redis"
      }
    ],
    layerImpacts: [
      {
        layer: "COMPONENT",
        serviceId: "redis",
        serviceName: "Redis",
        status: "ROOT_CAUSE",
        rationale: "Failing"
      },
      {
        layer: "COMPONENT",
        serviceId: "quote-api",
        serviceName: "Quote API",
        status: "AFFECTED",
        rationale: "Downstream"
      }
    ],
    narrative: "Redis failure cascades.",
    appHealth: "DEGRADED",
    propagationPath: []
  }
} as DeepDiagnosisResult;

describe("incident-causal-graph.service", () => {
  it("maps change event types", () => {
    expect(mapChangeEventType("DEPLOY_RELEASE")).toBe("DEPLOYMENT");
    expect(mapChangeEventType("CONFIG_UPDATE")).toBe("CONFIG_CHANGE");
  });

  it("classifies evidence types", () => {
    expect(classifyAnalysisEvidence("ALERT", "CORRELATION")).toBe("OBSERVED");
    expect(classifyAnalysisEvidence("DEPENDENCY", "CORRELATION")).toBe("INFERRED");
    expect(classifyAnalysisEvidence("RULE", "LLM")).toBe("AI_SUGGESTED");
  });

  it("maps root causes to valid topology nodes only", () => {
    const overlays = buildRootCauseOverlays({
      topology,
      diagnosis,
      candidates: [
        {
          kind: "ALERT_SIGNAL",
          referenceId: "alert-1",
          title: "Quote API failing",
          score: 0.7,
          rationale: "Direct alert signal.",
          metadata: { serviceId: "quote-api" }
        },
        {
          kind: "DEPENDENCY",
          referenceId: "missing",
          title: "Unknown service",
          score: 0.9,
          rationale: "Should be ignored.",
          metadata: { toServiceId: "missing-service" }
        }
      ]
    });

    expect(overlays[0]?.nodeId).toBe("redis");
    expect(overlays.some((row) => row.nodeId === "quote-api")).toBe(true);
    expect(overlays.some((row) => row.nodeId === "missing-service")).toBe(false);
  });

  it("builds numbered propagation edges in failure direction", () => {
    const edges = buildPropagationOverlays({ topology, diagnosis });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ sourceId: "redis", targetId: "quote-api", order: 1 });
  });

  it("returns valid empty overlay when diagnosis has no dependency impact", () => {
    const empty = buildIncidentCausalGraphResponse({
      incident: {
        id: "inc-1",
        projectId: "proj-1",
        title: "Unknown incident",
        status: "OPEN",
        severity: "MEDIUM"
      },
      topology,
      diagnosis: {
        diagnosis: "No clear root cause yet.",
        confidence: 0.2,
        analysisMode: "RULES",
        rootCauseHypothesis: null,
        evidence: [],
        topCandidates: [],
        suggestedActions: [],
        category: "UNKNOWN"
      } as DeepDiagnosisResult,
      candidates: [],
      incidentServiceIds: ["quote-api"],
      changeEvents: [],
      correlatedIncidents: []
    });

    expect(empty.overlay.probableRootCauses).toHaveLength(0);
    expect(empty.overlay.propagationEdges).toHaveLength(0);
    expect(empty.overlay.incidentNodeIds).toEqual(["quote-api"]);
  });

  it("aggregates affected node ids from impact and incident services", () => {
    const affected = buildAffectedNodeIds({
      topology,
      diagnosis,
      incidentServiceIds: ["quote-api"]
    });
    expect(affected).toContain("redis");
    expect(affected).toContain("quote-api");
  });
});
