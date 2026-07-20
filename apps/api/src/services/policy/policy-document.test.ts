import { describe, expect, it } from "vitest";
import { governanceModeCeiling } from "../entitlements/remediation-governance.service";
import { defaultAiAutomationPolicyDocument, POLICY_AREA_LABELS } from "./policy-document";

describe("policy-document", () => {
  it("defines all 25 policy areas", () => {
    expect(Object.keys(POLICY_AREA_LABELS)).toHaveLength(25);
    const doc = defaultAiAutomationPolicyDocument("AI_LED_SAFE");
    expect(doc.areas.operatingProfile.profile).toBe("AI_LED_SAFE");
    expect(doc.areas.predictions.enabled).toBe(true);
    expect(doc.areas.predictionNotifications.enabled).toBe(true);
    expect(doc.areas.autonomousExecution.orgCeilingMode).toBe("AUTO_HEAL_SAFE");
    expect(doc.areas.autonomousExecution.highImpact).toBe("approval_required");
    expect(doc.areas.recoveryVerification.threshold).toBe(2);
  });

  it("keeps monitor-only defaults conservative", () => {
    const doc = defaultAiAutomationPolicyDocument("MONITOR_ONLY");
    expect(doc.areas.predictions.enabled).toBe(false);
    expect(doc.areas.autonomousExecution.safeAutoHeal).toBe("off");
  });
});

describe("governanceModeCeiling", () => {
  it("allows AUTO_HEAL_SAFE when approval entitlement is on", () => {
    expect(
      governanceModeCeiling({
        tier: "POLICY_CONTROLLED",
        suggestedEnabled: true,
        approvalEnabled: true,
        autonomousEnabled: false
      })
    ).toBe("AUTO_HEAL_SAFE");
  });

  it("allows FULL_AUTONOMOUS only when autonomous entitlement is on", () => {
    expect(
      governanceModeCeiling({
        tier: "FULLY_AUTONOMOUS",
        suggestedEnabled: true,
        approvalEnabled: true,
        autonomousEnabled: true
      })
    ).toBe("FULL_AUTONOMOUS");
  });
});
