import { describe, expect, it } from "vitest";
import { resolveMonitoringState, resolveServiceHealth } from "./service-health.service";

describe("service-health.service", () => {
  it("returns UNKNOWN when no check has completed", () => {
    expect(
      resolveServiceHealth({
        storedStatus: "HEALTHY",
        activeCheckCount: 1,
        hasCompletedCheck: false,
        latestCheckFailed: false,
        openAlerts: 0,
        criticalOpenAlerts: 0,
        unresolvedIncidents: 0
      })
    ).toBe("UNKNOWN");
    expect(resolveMonitoringState({ activeCheckCount: 1, hasCompletedCheck: false })).toBe(
      "AWAITING_FIRST_CHECK"
    );
  });

  it("returns CRITICAL for down services or critical alerts after monitoring exists", () => {
    expect(
      resolveServiceHealth({
        storedStatus: "DOWN",
        activeCheckCount: 1,
        hasCompletedCheck: true,
        latestCheckFailed: true,
        openAlerts: 0,
        criticalOpenAlerts: 0,
        unresolvedIncidents: 0
      })
    ).toBe("CRITICAL");
  });

  it("returns DEGRADED for failed checks and open alerts", () => {
    expect(
      resolveServiceHealth({
        storedStatus: "HEALTHY",
        activeCheckCount: 1,
        hasCompletedCheck: true,
        latestCheckFailed: true,
        openAlerts: 0,
        criticalOpenAlerts: 0,
        unresolvedIncidents: 0
      })
    ).toBe("DEGRADED");
  });

  it("returns HEALTHY when monitored and no failure signals", () => {
    expect(
      resolveServiceHealth({
        storedStatus: "HEALTHY",
        activeCheckCount: 1,
        hasCompletedCheck: true,
        latestCheckFailed: false,
        openAlerts: 0,
        criticalOpenAlerts: 0,
        unresolvedIncidents: 0,
        sloStatus: "HEALTHY"
      })
    ).toBe("HEALTHY");
  });
});
