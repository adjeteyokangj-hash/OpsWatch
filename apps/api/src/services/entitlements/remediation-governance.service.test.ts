import { describe, expect, it, vi } from "vitest";
import {
  clampAutomationExecutionMode,
  resolveRemediationGovernance
} from "./remediation-governance.service";
import * as entitlementService from "./entitlement.service";

describe("remediation-governance.service", () => {
  it("derives governance tiers from entitlements", async () => {
    vi.spyOn(entitlementService, "isEntitlementEnabled").mockImplementation(async (_org, key) => {
      if (key === "remediation.suggested.enabled") return true;
      if (key === "remediation.approval.enabled") return true;
      if (key === "remediation.autonomous.enabled") return false;
      return false;
    });

    const governance = await resolveRemediationGovernance("org-1");
    expect(governance.tier).toBe("POLICY_CONTROLLED");
    expect(governance.approvalEnabled).toBe(true);
    expect(governance.autonomousEnabled).toBe(false);
  });

  it("clamps autonomous execution mode when plan lacks entitlement", async () => {
    vi.spyOn(entitlementService, "isEntitlementEnabled").mockImplementation(async (_org, key) => {
      if (key === "remediation.approval.enabled") return true;
      return false;
    });

    await expect(clampAutomationExecutionMode("org-1", "AUTONOMOUS")).resolves.toBe("APPROVAL");
    await expect(clampAutomationExecutionMode("org-1", "APPROVAL")).resolves.toBe("APPROVAL");
    await expect(clampAutomationExecutionMode("org-1", "OBSERVE")).resolves.toBe("OBSERVE");
  });
});
