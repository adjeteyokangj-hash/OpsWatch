import { describe, expect, it } from "vitest";
import {
  relationshipMarkerLabel,
  resolveRelationshipRemediationMarker
} from "./relationship-remediation-marker";

describe("relationship remediation markers", () => {
  it("does not rely on line colour alone for repair progress", () => {
    expect(
      resolveRelationshipRemediationMarker({ edgeStatus: "CRITICAL", runStatus: "EXECUTING" })
    ).toBe("repair_running");
    expect(
      resolveRelationshipRemediationMarker({ edgeStatus: "CRITICAL", runStatus: "VERIFYING" })
    ).toBe("verification_running");
    expect(
      resolveRelationshipRemediationMarker({ edgeStatus: "HEALTHY", runStatus: "VERIFIED_HEALTHY" })
    ).toBe("recovery_verified");
    expect(
      resolveRelationshipRemediationMarker({
        edgeStatus: "CRITICAL",
        runStatus: "VERIFICATION_FAILED"
      })
    ).toBe("repair_failed");
    expect(
      resolveRelationshipRemediationMarker({ edgeStatus: "UNKNOWN", evidenceFresh: false })
    ).toBe("evidence_stale");
  });

  it("exposes operator-readable labels", () => {
    expect(relationshipMarkerLabel("repair_failed")).toMatch(/failed/i);
  });
});
