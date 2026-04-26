import { describe, expect, it } from "vitest";
import {
  requiresApproval,
  isActionConfigured,
  validateContext,
  REMEDIATION_REGISTRY
} from "./actions";

describe("remediation action policy", () => {
  it("marks high-risk actions as approval-required", () => {
    expect(requiresApproval("RESTART_SERVICE")).toBe(true);
    expect(requiresApproval("ROLLBACK_DEPLOYMENT")).toBe(true);
    expect(requiresApproval("RETRY_WEBHOOKS")).toBe(false);
  });

  it("groups support actions separately", () => {
    expect(REMEDIATION_REGISTRY.CHECK_PROVIDER_STATUS.kind).toBe("support");
    expect(REMEDIATION_REGISTRY.OPEN_RUNBOOK.group).toBe("GROUP_C_SUPPORT");
  });

  it("reports configuration-dependent actions as unsupported when env is absent", () => {
    delete process.env.SERVICE_RESTART_WEBHOOK_URL;
    delete process.env.DEPLOYMENT_ROLLBACK_WEBHOOK_URL;

    expect(isActionConfigured("RESTART_SERVICE")).toBe(false);
    expect(isActionConfigured("ROLLBACK_DEPLOYMENT")).toBe(false);
    expect(isActionConfigured("RETRY_WEBHOOKS")).toBe(true);
  });

  it("prefers project integration config over global env for required integration actions", () => {
    delete process.env.SERVICE_RESTART_WEBHOOK_URL;

    const missing = validateContext("RESTART_SERVICE", {
      organizationId: "o1",
      serviceId: "s1"
    });
    expect(missing.missingEnvVars).toContain("SERVICE_RESTART_WEBHOOK_URL");

    const configured = validateContext(
      "RESTART_SERVICE",
      { organizationId: "o1", serviceId: "s1" },
      [
        {
          type: "SERVICE_PROVIDER",
          enabled: true,
          configJson: { SERVICE_RESTART_WEBHOOK_URL: "https://provider.example/restart" }
        }
      ]
    );
    expect(configured.missingEnvVars).toHaveLength(0);
  });
});
