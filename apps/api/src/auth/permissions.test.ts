import { describe, expect, it } from "vitest";
import {
  canExecuteRemediationAction,
  canTriggerAutoHeal,
  hasPermission,
  normalizeRole
} from "./permissions";

describe("permissions", () => {
  it("maps legacy MEMBER to INCIDENT_RESPONDER", () => {
    expect(normalizeRole("MEMBER")).toBe("INCIDENT_RESPONDER");
  });

  it("allows incident responders to run safe remediation only", () => {
    expect(hasPermission("INCIDENT_RESPONDER", "remediation:execute:safe")).toBe(true);
    expect(hasPermission("INCIDENT_RESPONDER", "remediation:auto_heal")).toBe(false);
    expect(canExecuteRemediationAction("INCIDENT_RESPONDER", "RERUN_HTTP_CHECK", false)).toBe(true);
    expect(canExecuteRemediationAction("INCIDENT_RESPONDER", "REVIEW_HTTP_EXPECTED_STATUS", true)).toBe(
      false
    );
  });

  it("allows automation operators to approve and auto-heal", () => {
    expect(canTriggerAutoHeal("AUTOMATION_OPERATOR")).toBe(true);
    expect(canExecuteRemediationAction("AUTOMATION_OPERATOR", "REVIEW_HTTP_EXPECTED_STATUS", true)).toBe(
      true
    );
  });

  it("restricts viewers to read-only diagnosis and observe planning", () => {
    expect(hasPermission("VIEWER", "diagnosis:read")).toBe(true);
    expect(hasPermission("VIEWER", "automation:plan:observe")).toBe(true);
    expect(hasPermission("VIEWER", "remediation:execute:safe")).toBe(false);
  });

  it("keeps security evidence off ordinary viewers and limits responders", () => {
    expect(hasPermission("VIEWER", "security:read")).toBe(false);
    expect(hasPermission("INCIDENT_RESPONDER", "security:read")).toBe(true);
    expect(hasPermission("INCIDENT_RESPONDER", "security:investigate")).toBe(true);
    expect(hasPermission("INCIDENT_RESPONDER", "security:respond")).toBe(false);
    expect(hasPermission("INCIDENT_RESPONDER", "security:approve_high_risk")).toBe(false);
    expect(hasPermission("INCIDENT_RESPONDER", "security:manage_rules")).toBe(false);
    expect(hasPermission("AUTOMATION_OPERATOR", "security:respond")).toBe(true);
    expect(hasPermission("AUTOMATION_OPERATOR", "security:approve_high_risk")).toBe(false);
    expect(hasPermission("ADMIN", "security:approve_high_risk")).toBe(true);
  });
});
