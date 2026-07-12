import { describe, expect, it } from "vitest";
import { computeProjectHealth } from "./project-health.service";

describe("project-recovery lifecycle integration", () => {
  it("preserves RECOVERING while verification is active", () => {
    const snapshot = computeProjectHealth({
      storedStatus: "DEGRADED",
      verificationActive: true,
      monitoringEnabled: true,
      isActive: true,
      services: [
        {
          id: "svc",
          name: "API",
          type: "COMPONENT",
          status: "DEGRADED",
          criticality: "HIGH",
          Check: [
            {
              isActive: true,
              CheckResult: [{ status: "FAIL", checkedAt: new Date(), responseCode: 500 }]
            }
          ]
        }
      ],
      openAlerts: [{ serviceId: "svc", severity: "HIGH" }],
      unresolvedIncidents: []
    });

    expect(snapshot.status).toBe("RECOVERING");
    expect(snapshot.healthReason).toContain("awaiting verification");
  });
});
