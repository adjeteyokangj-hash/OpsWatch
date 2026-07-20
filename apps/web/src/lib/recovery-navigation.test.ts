import { describe, expect, it } from "vitest";
import {
  buildTopologyDeepLink,
  primaryActionButtonLabel,
  resolveConfigureSetupTarget,
  topologyLinkKindForRecovery,
  topologyRecoveryLinkLabel
} from "./recovery-navigation";

describe("recovery-navigation", () => {
  it("builds topology deep links with entity and incident", () => {
    expect(
      buildTopologyDeepLink({
        projectId: "proj-1",
        entityId: "svc-api",
        incidentId: "inc-1",
        recoveryState: "VERIFYING"
      })
    ).toBe("/projects/proj-1/topology?entityId=svc-api&incidentId=inc-1&recoveryState=VERIFYING");
  });

  it("picks topology CTA labels from recovery progress", () => {
    expect(
      topologyRecoveryLinkLabel(
        topologyLinkKindForRecovery({
          unresolvedAlertCount: 2,
          verificationPassed: 0,
          verificationRequired: 2
        })
      )
    ).toBe("View verification in Topology");

    expect(
      topologyRecoveryLinkLabel(
        topologyLinkKindForRecovery({
          incidentStatus: "RESOLVED",
          unresolvedAlertCount: 0,
          verificationMet: true
        })
      )
    ).toBe("Confirm recovery in Topology");
  });

  it("routes Not configured blockers to specific setup destinations", () => {
    expect(
      resolveConfigureSetupTarget({
        action: "RESTART_SERVICE",
        projectId: "proj-1",
        serviceId: "svc-1",
        state: "MISCONFIGURED_ENV",
        missingEnvVars: ["REMEDIATOR_URL"]
      })?.href
    ).toContain("/topology?entityId=svc-1");

    expect(
      resolveConfigureSetupTarget({
        action: "RERUN_HTTP_CHECK",
        checkId: "check-9",
        state: "MISSING_CONTEXT"
      })?.href
    ).toBe("/checks/check-9");
  });

  it("uses non-repair labels for review and check actions", () => {
    expect(primaryActionButtonLabel("REQUEST_HUMAN_REVIEW")).toBe("Request review");
    expect(primaryActionButtonLabel("RERUN_HTTP_CHECK")).toBe("Run check now");
  });
});
