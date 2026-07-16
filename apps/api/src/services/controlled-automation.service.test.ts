import { afterEach, describe, expect, it } from "vitest";
import {
  computeErrorBudget,
  evaluateControlledAutomationGate,
  isAutoRepairEnabled,
  isAutomationTestMode,
  runAutomationTestMode
} from "./controlled-automation.service";

describe("controlled-automation.service (phase 7)", () => {
  const originalTest = process.env.OPSWATCH_AUTOMATION_TEST_MODE;
  const originalRepair = process.env.OPSWATCH_AUTO_REPAIR_ENABLED;

  const clearGateEnv = () => {
    // Local/API .env may set these true; isolate every case from process env pollution.
    delete process.env.OPSWATCH_AUTOMATION_TEST_MODE;
    delete process.env.OPSWATCH_AUTO_REPAIR_ENABLED;
  };

  afterEach(() => {
    if (originalTest === undefined) delete process.env.OPSWATCH_AUTOMATION_TEST_MODE;
    else process.env.OPSWATCH_AUTOMATION_TEST_MODE = originalTest;
    if (originalRepair === undefined) delete process.env.OPSWATCH_AUTO_REPAIR_ENABLED;
    else process.env.OPSWATCH_AUTO_REPAIR_ENABLED = originalRepair;
  });

  it("keeps automation test mode and auto-repair OFF by default", () => {
    clearGateEnv();
    expect(isAutomationTestMode()).toBe(false);
    expect(isAutoRepairEnabled()).toBe(false);
  });

  it("blocks high-impact actions by default", () => {
    clearGateEnv();
    const gate = evaluateControlledAutomationGate("ROLLBACK_DEPLOYMENT");
    expect(gate.allowed).toBe(false);
    expect(gate.mode).toBe("BLOCKED");
    expect(gate.impactTier).toBe("HIGH");
  });

  it("requires approval for medium-impact restart even when auto-repair is on", () => {
    clearGateEnv();
    process.env.OPSWATCH_AUTO_REPAIR_ENABLED = "true";
    const gate = evaluateControlledAutomationGate("RESTART_SERVICE");
    expect(gate.mode).toBe("APPROVAL_REQUIRED");
    expect(gate.allowed).toBe(false);
  });

  it("allows low-impact allowlisted actions to execute", () => {
    clearGateEnv();
    const gate = evaluateControlledAutomationGate("RERUN_HTTP_CHECK");
    expect(gate.allowed).toBe(true);
    expect(gate.mode).toBe("EXECUTE");
    expect(gate.inAutoRunAllowlist).toBe(true);
  });

  it("records test-mode results without enabling live high-risk execution", () => {
    clearGateEnv();
    process.env.OPSWATCH_AUTOMATION_TEST_MODE = "true";
    const result = runAutomationTestMode("ROLLBACK_DEPLOYMENT");
    expect(result.gate.mode).toBe("TEST_ONLY");
    expect(result.wouldExecute).toBe(false);
    expect(result.simulatedOutcome).toBe("WOULD_BLOCK");
  });

  it("computes error budget remaining from availability vs target", () => {
    const snap = computeErrorBudget({
      targetPct: 99.9,
      availabilityPct: 99.95,
      burnRate: 0.4,
      status: "HEALTHY",
      windowMinutes: 60
    });
    expect(snap.errorBudgetRemainingPct).toBeGreaterThan(0);
    expect(snap.errorBudgetRemainingPct).toBeLessThanOrEqual(100);
    expect(snap.status).toBe("HEALTHY");
  });
});
