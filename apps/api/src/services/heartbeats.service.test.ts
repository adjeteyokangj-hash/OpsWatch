import { describe, expect, it } from "vitest";
import { ProjectStatus } from "@prisma/client";
import { projectStatusFromHeartbeat } from "./heartbeats.service";

describe("projectStatusFromHeartbeat", () => {
  it("does not turn a fresh down heartbeat back into healthy", () => {
    expect(projectStatusFromHeartbeat("DOWN")).toBe(ProjectStatus.DOWN);
  });

  it("preserves degraded and paused heartbeat states", () => {
    expect(projectStatusFromHeartbeat("DEGRADED")).toBe(ProjectStatus.DEGRADED);
    expect(projectStatusFromHeartbeat("PAUSED")).toBe(ProjectStatus.PAUSED);
  });

  it("defaults accepted non-failure heartbeats to healthy", () => {
    expect(projectStatusFromHeartbeat("HEALTHY")).toBe(ProjectStatus.HEALTHY);
    expect(projectStatusFromHeartbeat(undefined)).toBe(ProjectStatus.HEALTHY);
  });
});
