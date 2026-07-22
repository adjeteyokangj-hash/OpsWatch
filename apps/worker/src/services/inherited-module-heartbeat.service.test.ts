import { describe, expect, it } from "vitest";
import { ProjectStatus } from "@prisma/client";
import {
  inheritedHeartbeatStatus,
  runtimeEvidenceIsStale
} from "./inherited-module-heartbeat.service";

describe("inheritedHeartbeatStatus", () => {
  it("inherits a fresh healthy application heartbeat", () => {
    expect(
      inheritedHeartbeatStatus({ heartbeatStatus: "HEALTHY", ageMinutes: 1 })
    ).toBe(ProjectStatus.HEALTHY);
  });

  it("preserves fresh degraded, down and paused states", () => {
    expect(
      inheritedHeartbeatStatus({ heartbeatStatus: "DEGRADED", ageMinutes: 1 })
    ).toBe(ProjectStatus.DEGRADED);
    expect(
      inheritedHeartbeatStatus({ heartbeatStatus: "DOWN", ageMinutes: 1 })
    ).toBe(ProjectStatus.DOWN);
    expect(
      inheritedHeartbeatStatus({ heartbeatStatus: "PAUSED", ageMinutes: 1 })
    ).toBe(ProjectStatus.PAUSED);
  });

  it("marks any heartbeat stale after ten minutes", () => {
    expect(
      inheritedHeartbeatStatus({ heartbeatStatus: "HEALTHY", ageMinutes: 10 })
    ).toBe(ProjectStatus.DEGRADED);
    expect(
      inheritedHeartbeatStatus({ heartbeatStatus: "DOWN", ageMinutes: 25 })
    ).toBe(ProjectStatus.DEGRADED);
  });

  it("uses the same ten-minute boundary for signed runtime evidence", () => {
    expect(runtimeEvidenceIsStale(9.99)).toBe(false);
    expect(runtimeEvidenceIsStale(10)).toBe(true);
    expect(runtimeEvidenceIsStale(25)).toBe(true);
  });
});
