import { describe, expect, it } from "vitest";
import {
  resolveMonitoringState,
  resolveRelationshipEdgeHealth,
  resolveServiceHealth,
  worstHealth
} from "./service-health.service";

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

  it("keeps open-alert DEGRADED when merging with stored HEALTHY entity health", () => {
    expect(worstHealth(["DEGRADED", "HEALTHY"])).toBe("DEGRADED");
    expect(worstHealth(["CRITICAL", "HEALTHY"])).toBe("CRITICAL");
  });
});

describe("resolveRelationshipEdgeHealth", () => {
  it("returns CRITICAL when linked alerts or failed checks exist", () => {
    expect(
      resolveRelationshipEdgeHealth({
        sourceHealth: "HEALTHY",
        targetHealth: "UNKNOWN",
        relatedOpenAlerts: 1,
        relatedCriticalAlerts: 1,
        relatedFailedChecks: 0,
        relatedWarnChecks: 0,
        hasTargetEvidence: false,
        hasAnyEndpointEvidence: true
      }).status
    ).toBe("CRITICAL");
  });

  it("returns HEALTHY only when target has monitoring evidence", () => {
    expect(
      resolveRelationshipEdgeHealth({
        sourceHealth: "HEALTHY",
        targetHealth: "HEALTHY",
        relatedOpenAlerts: 0,
        relatedCriticalAlerts: 0,
        relatedFailedChecks: 0,
        relatedWarnChecks: 0,
        hasTargetEvidence: true,
        hasAnyEndpointEvidence: true
      }).status
    ).toBe("HEALTHY");
  });

  it("returns UNKNOWN when source is healthy but target has no evidence", () => {
    expect(
      resolveRelationshipEdgeHealth({
        sourceHealth: "HEALTHY",
        targetHealth: "UNKNOWN",
        relatedOpenAlerts: 0,
        relatedCriticalAlerts: 0,
        relatedFailedChecks: 0,
        relatedWarnChecks: 0,
        hasTargetEvidence: false,
        hasAnyEndpointEvidence: true
      }).status
    ).toBe("UNKNOWN");
  });

  it("returns DEGRADED for warn checks or degraded endpoints", () => {
    expect(
      resolveRelationshipEdgeHealth({
        sourceHealth: "HEALTHY",
        targetHealth: "HEALTHY",
        relatedOpenAlerts: 0,
        relatedCriticalAlerts: 0,
        relatedFailedChecks: 0,
        relatedWarnChecks: 1,
        hasTargetEvidence: true,
        hasAnyEndpointEvidence: true
      }).status
    ).toBe("DEGRADED");
  });
});
