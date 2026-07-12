import { describe, expect, it } from "vitest";
import { analyzeIncidentDeep } from "./incident-analysis.service";

const baseContext = {
  incidentId: "inc-1",
  title: "Diagnosis Demo HTTP Check failing",
  severity: "HIGH",
  status: "OPEN",
  projectId: "proj-1",
  projectName: "Noble Express",
  openedAt: new Date("2026-07-10T12:00:00.000Z"),
  services: [
    { id: "app", name: "Noble Express", type: "APP" },
    { id: "quotes-module", name: "Quotes", type: "MODULE" },
    { id: "tracking-module", name: "Tracking", type: "MODULE" },
    { id: "quote-workflow", name: "Customer Quote Journey", type: "WORKFLOW" },
    { id: "quote-api", name: "Quote API", type: "COMPONENT" },
    { id: "pricing-engine", name: "Pricing Engine", type: "COMPONENT" },
    { id: "redis", name: "Redis", type: "COMPONENT" }
  ],
  dependencyEdges: [
    { fromServiceId: "quotes-module", toServiceId: "app", dependencyType: "HIERARCHY", criticality: "HIGH" },
    { fromServiceId: "tracking-module", toServiceId: "app", dependencyType: "HIERARCHY", criticality: "HIGH" },
    { fromServiceId: "quote-workflow", toServiceId: "quotes-module", dependencyType: "HIERARCHY", criticality: "HIGH" },
    { fromServiceId: "quote-api", toServiceId: "quote-workflow", dependencyType: "HIERARCHY", criticality: "HIGH" },
    { fromServiceId: "pricing-engine", toServiceId: "quote-workflow", dependencyType: "HIERARCHY", criticality: "HIGH" },
    { fromServiceId: "pricing-engine", toServiceId: "redis", dependencyType: "RUNTIME", criticality: "CRITICAL" },
    { fromServiceId: "quote-api", toServiceId: "pricing-engine", dependencyType: "RUNTIME", criticality: "CRITICAL" },
    { fromServiceId: "quote-workflow", toServiceId: "quote-api", dependencyType: "RUNTIME", criticality: "CRITICAL" },
    { fromServiceId: "quotes-module", toServiceId: "quote-workflow", dependencyType: "RUNTIME", criticality: "HIGH" },
    { fromServiceId: "app", toServiceId: "quotes-module", dependencyType: "RUNTIME", criticality: "HIGH" }
  ],
  failingServiceIds: ["redis", "pricing-engine", "quote-api", "quote-workflow"],
  checkFailures: [],
  sloBreaches: []
};

describe("incident-analysis.service", () => {
  it("classifies expected 503 got 200 as HTTP status mismatch instead of unreachable", async () => {
    const result = await analyzeIncidentDeep({
      ...baseContext,
      alerts: [
        {
          id: "alert-1",
          title: "Diagnosis Demo HTTP Check failing",
          message: "[HTTP_STATUS_MISMATCH] Expected 503, received 200.",
          severity: "HIGH",
          status: "OPEN",
          sourceType: "CHECK",
          category: "AVAILABILITY",
          serviceId: "quote-api",
          sourceId: null
        }
      ],
      timeline: [],
      candidates: [],
      checkFailures: [
        {
          alertId: "alert-1",
          message: "[HTTP_STATUS_MISMATCH] Expected 503, received 200.",
          expectedStatusCode: 503,
          actualStatusCode: 200,
          failureClass: "HTTP_STATUS_MISMATCH"
        }
      ]
    });

    expect(result.failureClass).toBe("HTTP_STATUS_MISMATCH");
    expect(result.diagnosis).toContain("responded successfully");
    expect(result.diagnosis).not.toContain("not responding to health checks");
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.possibleCauses).toContain("Health check expectation is misconfigured");
  });

  it("identifies upstream redis as dependency-aware root cause", async () => {
    const result = await analyzeIncidentDeep({
      ...baseContext,
      alerts: [
        {
          id: "alert-1",
          title: "Quote API failing",
          message: "[CONNECTION_REFUSED] Endpoint refused the connection.",
          severity: "HIGH",
          status: "OPEN",
          sourceType: "CHECK",
          category: "AVAILABILITY",
          serviceId: "quote-api",
          sourceId: null
        }
      ],
      timeline: [],
      candidates: [],
      checkFailures: [
        {
          alertId: "alert-1",
          message: "[CONNECTION_REFUSED] Endpoint refused the connection.",
          failureClass: "CONNECTION_REFUSED"
        }
      ]
    });

    expect(result.dependencyImpact?.probableRootCause?.serviceName).toBe("Redis");
    expect(result.layerImpacts?.find((row) => row.serviceName === "Noble Express")?.status).toBe("DEGRADED");
  });
});
