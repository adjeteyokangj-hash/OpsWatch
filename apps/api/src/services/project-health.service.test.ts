import { describe, expect, it } from "vitest";
import { computeProjectHealth, healthDisplayLabel } from "./project-health.service";

describe("project-health.service", () => {
  it("returns UNKNOWN when no completed checks exist", () => {
    const snapshot = computeProjectHealth({
      storedStatus: "DEGRADED",
      monitoringEnabled: true,
      isActive: true,
      services: [
        {
          id: "svc-1",
          name: "API",
          type: "COMPONENT",
          status: "HEALTHY",
          criticality: "HIGH",
          Check: [{ isActive: true, CheckResult: [] }]
        }
      ],
      openAlerts: [],
      unresolvedIncidents: []
    });

    expect(snapshot.status).toBe("UNKNOWN");
    expect(snapshot.healthReason).toContain("Waiting for first heartbeat");
    expect(healthDisplayLabel("UNKNOWN")).toBe("Waiting for first heartbeat");
  });

  it("does not mark project DOWN when only low-criticality component fails", () => {
    const snapshot = computeProjectHealth({
      storedStatus: "HEALTHY",
      monitoringEnabled: true,
      isActive: true,
      services: [
        {
          id: "svc-1",
          name: "Analytics",
          type: "COMPONENT",
          status: "HEALTHY",
          criticality: "LOW",
          Check: [
            {
              isActive: true,
              CheckResult: [{ status: "FAIL", checkedAt: new Date(), responseCode: 500 }]
            }
          ]
        }
      ],
      openAlerts: [{ serviceId: "svc-1", severity: "HIGH" }],
      unresolvedIncidents: []
    });

    expect(snapshot.status).toBe("DEGRADED");
  });
});
