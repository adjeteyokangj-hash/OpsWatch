import { describe, expect, it } from "vitest";
import { deriveMaintenanceRemediationBehaviour } from "./maintenance-remediation-policy.service";

describe("maintenance remediation policy options", () => {
  it("derives ALLOW_LOW_RISK when autonomous is permitted", () => {
    expect(
      deriveMaintenanceRemediationBehaviour({
        inMaintenance: true,
        suppressAlerts: true,
        suppressIncidents: false,
        allowAutonomous: true
      })
    ).toBe("ALLOW_LOW_RISK");
  });

  it("derives SUPPRESS when alerts are suppressed without autonomous", () => {
    expect(
      deriveMaintenanceRemediationBehaviour({
        inMaintenance: true,
        suppressAlerts: true,
        suppressIncidents: false,
        allowAutonomous: false
      })
    ).toBe("SUPPRESS");
  });

  it("honours explicit remediationPolicy override", () => {
    expect(
      deriveMaintenanceRemediationBehaviour({
        inMaintenance: true,
        suppressAlerts: true,
        suppressIncidents: false,
        allowAutonomous: false,
        remediationPolicy: "DEFER"
      })
    ).toBe("DEFER");
    expect(
      deriveMaintenanceRemediationBehaviour({
        inMaintenance: true,
        suppressAlerts: false,
        suppressIncidents: false,
        allowAutonomous: false,
        remediationPolicy: "EMERGENCY_ONLY"
      })
    ).toBe("EMERGENCY_ONLY");
  });
});
