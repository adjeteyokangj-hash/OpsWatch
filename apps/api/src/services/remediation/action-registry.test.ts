import { describe, expect, it } from "vitest";
import {
  getUniversalAction,
  listUniversalActions,
  UNIVERSAL_ACTION_REGISTRY
} from "./action-registry";
import { resolveActionAvailability } from "./availability.service";
import {
  clearRemediationProvidersForTests,
  listRemediationProviders,
  registerRemediationProvider
} from "./provider-adapter";

describe("Phase 7 action registry", () => {
  it("looks up actions from the universal registry", () => {
    const restart = getUniversalAction("RESTART_WORKER");
    expect(restart?.providerType).toBe("worker_remediator");
    expect(restart?.riskLevel).toBe("MEDIUM");
    expect(restart?.verificationStrategy).toBe("PROVIDER_PLUS_HEALTH_CHECK");
  });

  it("lists only enabled actions", () => {
    const keys = listUniversalActions().map((row) => row.actionKey);
    expect(keys).toContain("TEST_CONNECTION");
    expect(keys).not.toContain("RETRY_PAYMENT_VERIFICATION");
  });

  it("classifies connection actions as low or medium risk", () => {
    expect(UNIVERSAL_ACTION_REGISTRY.TEST_CONNECTION.riskLevel).toBe("LOW");
    expect(UNIVERSAL_ACTION_REGISTRY.REENABLE_CONNECTION.riskLevel).toBe("MEDIUM");
    expect(UNIVERSAL_ACTION_REGISTRY.ROLLBACK_DEPLOYMENT.riskLevel).toBe("HIGH");
  });

  it("returns SETUP_REQUIRED when connectionId is missing", () => {
    const result = resolveActionAvailability({
      actionKey: "TEST_CONNECTION",
      context: { organizationId: "org-1" },
      automationMode: "APPROVAL"
    });
    expect(result?.state).toBe("SETUP_REQUIRED");
    expect(result?.reason).toMatch(/connectionId/i);
  });

  it("returns OBSERVE_ONLY when project mode is observe", () => {
    const result = resolveActionAvailability({
      actionKey: "RERUN_HTTP_CHECK",
      context: { organizationId: "org-1", serviceId: "svc-1" },
      automationMode: "OBSERVE"
    });
    expect(result?.state).toBe("OBSERVE_ONLY");
  });

  it("returns APPROVAL_REQUIRED for medium-risk autonomous attempts", () => {
    const result = resolveActionAvailability({
      actionKey: "RESTART_WORKER",
      context: { organizationId: "org-1", projectId: "proj-1" },
      automationMode: "AUTONOMOUS",
      capabilityAvailable: true,
      integrations: [
        {
          type: "WORKER_PROVIDER",
          enabled: true,
          validationStatus: "VALID",
          configJson: { WORKER_RESTART_WEBHOOK_URL: "http://127.0.0.1:9/remediator" }
        }
      ]
    });
    expect(result?.state).toBe("APPROVAL_REQUIRED");
  });

  it("returns BLOCKED when circuit is open", () => {
    const result = resolveActionAvailability({
      actionKey: "RETRY_WEBHOOKS",
      context: { organizationId: "org-1" },
      automationMode: "APPROVAL",
      circuitOpen: true,
      circuitReason: "Repeated failures tripped the breaker"
    });
    expect(result?.state).toBe("BLOCKED");
  });

  it("marks unsupported missing-scope remediator actions as setup required", () => {
    const result = resolveActionAvailability({
      actionKey: "RESTART_WORKER",
      context: { organizationId: "org-1", projectId: "proj-1" },
      automationMode: "APPROVAL",
      integrations: []
    });
    expect(result?.state).toBe("SETUP_REQUIRED");
  });

  it("supports registering provider adapters on the shared interface", async () => {
    clearRemediationProvidersForTests();
    registerRemediationProvider({
      providerKey: "connection",
      listCapabilities: async () => [
        {
          actionKey: "TEST_CONNECTION",
          displayName: "Test connection",
          riskLevel: "LOW",
          requiresApproval: false,
          requiredScopes: ["connection:test"],
          verificationStrategy: "CONNECTION_TEST",
          rollbackCapability: "NONE",
          available: true
        }
      ],
      validateAction: async () => ({
        valid: true,
        availabilityState: "READY",
        reason: "ok"
      }),
      executeAction: async () => ({
        success: true,
        status: "COMPLETED",
        summary: "ok"
      }),
      verifyAction: async () => ({
        state: "VERIFIED_HEALTHY",
        summary: "ok",
        evidence: {}
      })
    });
    expect(listRemediationProviders()).toHaveLength(1);
    const caps = await listRemediationProviders()[0].listCapabilities({
      organizationId: "org-1"
    });
    expect(caps[0]?.actionKey).toBe("TEST_CONNECTION");
    clearRemediationProvidersForTests();
  });
});
