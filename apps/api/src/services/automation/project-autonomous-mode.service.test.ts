import { describe, expect, it } from "vitest";
import {
  AUTONOMOUS_MODE_RANK,
  getAutonomousModeCapabilities,
  normalizeProjectAutonomousMode,
  toAutomationRunExecutionMode
} from "@opswatch/shared";

describe("project autonomous mode shared helpers", () => {
  it("normalizes legacy automation modes", () => {
    expect(normalizeProjectAutonomousMode("OBSERVE")).toBe("MONITOR_ONLY");
    expect(normalizeProjectAutonomousMode("APPROVAL")).toBe("RECOMMEND");
    expect(normalizeProjectAutonomousMode("AUTONOMOUS")).toBe("FULL_AUTONOMOUS");
  });

  it("describes capabilities per mode", () => {
    expect(getAutonomousModeCapabilities("MONITOR_ONLY").allowsAutoExecution).toBe(false);
    expect(getAutonomousModeCapabilities("RECOMMEND").allowsPlanning).toBe(true);
    expect(getAutonomousModeCapabilities("AUTO_HEAL_SAFE").onlyAllowlistedActions).toBe(true);
    expect(getAutonomousModeCapabilities("FULL_AUTONOMOUS").onlyAllowlistedActions).toBe(false);
  });

  it("maps modes to automation run execution modes", () => {
    expect(toAutomationRunExecutionMode("RECOMMEND")).toBe("APPROVAL");
    expect(toAutomationRunExecutionMode("AUTO_HEAL_SAFE")).toBe("AUTONOMOUS");
    expect(toAutomationRunExecutionMode("MONITOR_ONLY")).toBe("OBSERVE");
  });

  it("ranks modes for clamping", () => {
    expect(AUTONOMOUS_MODE_RANK.FULL_AUTONOMOUS).toBeGreaterThan(AUTONOMOUS_MODE_RANK.AUTO_HEAL_SAFE);
    expect(AUTONOMOUS_MODE_RANK.DISABLED).toBeLessThan(AUTONOMOUS_MODE_RANK.MONITOR_ONLY);
  });
});
