/**
 * Phase 7 authoritative remediation action registry.
 * UI, alerts, incidents, topology, and workers must resolve actions through this module.
 */
import {
  REMEDIATION_REGISTRY,
  type ActionDef,
  type RemediationAction as LegacyRemediationAction
} from "./actions";

/** Local copies keep unit tests independent of shared package rebuild timing. */
export type RemediationAvailabilityState =
  | "READY"
  | "APPROVAL_REQUIRED"
  | "SETUP_REQUIRED"
  | "BLOCKED"
  | "NO_AUTOMATED_FIX"
  | "OBSERVE_ONLY";

export type RemediationRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type RemediationAutomationMode = "OBSERVE" | "APPROVAL" | "AUTONOMOUS";
export type RemediationProviderKey =
  | "opswatch_native"
  | "worker_remediator"
  | "service_remediator"
  | "deployment_remediator"
  | "connection"
  | "notification"
  | "support";

export type Phase7RemediationAction =
  | LegacyRemediationAction
  | "TEST_CONNECTION"
  | "REFRESH_CONNECTION_STATUS"
  | "REENABLE_CONNECTION"
  | "REQUEST_FRESH_HEARTBEAT";

export type RemediationEntityType =
  | "ALERT"
  | "INCIDENT"
  | "SERVICE"
  | "CHECK"
  | "CONNECTION"
  | "PROJECT"
  | "RELATIONSHIP"
  | "WORKER"
  | "INTEGRATION";

export type VerificationStrategy =
  | "NONE"
  | "IMMEDIATE_CHECK_RESULT"
  | "CONNECTION_TEST"
  | "HEARTBEAT_RESUME"
  | "PROVIDER_PLUS_HEALTH_CHECK"
  | "EXPECTED_STATUS_RERUN"
  | "CHANNEL_STATE"
  | "MANUAL_ONLY";

export type RollbackCapability =
  | "NONE"
  | "REVERT_CHECK_EXPECTED_STATUS"
  | "REMEDIATOR_ROLLBACK_DEPLOYMENT"
  | "REENABLE_CONNECTION"
  | "MANUAL_OPERATOR";

export interface ActionRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  backoffMultiplier: number;
}

export interface ActionRateLimitPolicy {
  maxPerProjectPerHour: number;
  maxConcurrent: number;
}

export interface ActionCircuitBreakerPolicy {
  failureThreshold: number;
  openMs: number;
  includeVerificationFailures: boolean;
  includeRollbackFailures: boolean;
}

export interface UniversalActionDefinition {
  actionKey: Phase7RemediationAction;
  displayName: string;
  description: string;
  providerType: RemediationProviderKey;
  supportedEntityTypes: RemediationEntityType[];
  supportedRelationshipTypes: string[];
  requiredConnectionMode: string | null;
  requiredScopes: string[];
  riskLevel: RemediationRiskLevel;
  supportedAutomationModes: RemediationAutomationMode[];
  inputSchema: Record<string, unknown>;
  timeoutMs: number;
  retryPolicy: ActionRetryPolicy;
  rateLimit: ActionRateLimitPolicy;
  circuitBreakerPolicy: ActionCircuitBreakerPolicy;
  maintenanceWindowBehaviour: "ALLOW_LOW_RISK" | "REQUIRE_APPROVAL" | "SUPPRESS" | "DEFER";
  rollbackCapability: RollbackCapability;
  verificationStrategy: VerificationStrategy;
  evidenceRequirements: string[];
  enabled: boolean;
  /** Legacy registry fields retained for compatibility. */
  legacy?: ActionDef;
  requiresApproval: boolean;
  kind: "fix" | "support";
}

const defaultRetry = (maxAttempts = 2): ActionRetryPolicy => ({
  maxAttempts,
  baseDelayMs: 5_000,
  backoffMultiplier: 2
});

const defaultRate = (maxPerHour = 20, maxConcurrent = 1): ActionRateLimitPolicy => ({
  maxPerProjectPerHour: maxPerHour,
  maxConcurrent
});

const defaultCircuit = (): ActionCircuitBreakerPolicy => ({
  failureThreshold: 3,
  openMs: 15 * 60_000,
  includeVerificationFailures: true,
  includeRollbackFailures: true
});

const fromLegacy = (
  actionKey: LegacyRemediationAction,
  overrides: Partial<UniversalActionDefinition> & {
    providerType: RemediationProviderKey;
    riskLevel: RemediationRiskLevel;
    verificationStrategy: VerificationStrategy;
    rollbackCapability: RollbackCapability;
  }
): UniversalActionDefinition => {
  const legacy = REMEDIATION_REGISTRY[actionKey];
  const modes: RemediationAutomationMode[] =
    legacy.policyTier === "SAFE_AUTOMATIC"
      ? ["OBSERVE", "APPROVAL", "AUTONOMOUS"]
      : legacy.policyTier === "APPROVAL_REQUIRED"
        ? ["OBSERVE", "APPROVAL"]
        : ["OBSERVE"];

  return {
    actionKey,
    displayName: legacy.label,
    description: legacy.description,
    providerType: overrides.providerType,
    supportedEntityTypes: overrides.supportedEntityTypes ?? ["INCIDENT", "ALERT", "SERVICE"],
    supportedRelationshipTypes: overrides.supportedRelationshipTypes ?? ["DEPENDENCY", "SYNC"],
    requiredConnectionMode: overrides.requiredConnectionMode ?? null,
    requiredScopes: overrides.requiredScopes ?? legacy.requiredEnvVars,
    riskLevel: overrides.riskLevel,
    supportedAutomationModes: overrides.supportedAutomationModes ?? modes,
    inputSchema: overrides.inputSchema ?? {
      type: "object",
      properties: {
        organizationId: { type: "string" },
        projectId: { type: "string" },
        incidentId: { type: "string" },
        alertId: { type: "string" }
      },
      required: ["organizationId"]
    },
    timeoutMs: overrides.timeoutMs ?? 60_000,
    retryPolicy: overrides.retryPolicy ?? defaultRetry(legacy.kind === "fix" ? 2 : 0),
    rateLimit: overrides.rateLimit ?? defaultRate(),
    circuitBreakerPolicy: overrides.circuitBreakerPolicy ?? defaultCircuit(),
    maintenanceWindowBehaviour:
      overrides.maintenanceWindowBehaviour ??
      (overrides.riskLevel === "LOW" ? "ALLOW_LOW_RISK" : "REQUIRE_APPROVAL"),
    rollbackCapability: overrides.rollbackCapability,
    verificationStrategy: overrides.verificationStrategy,
    evidenceRequirements:
      overrides.evidenceRequirements ??
      (overrides.verificationStrategy === "NONE"
        ? []
        : ["sanitised_provider_result", "post_action_health_signal"]),
    enabled: overrides.enabled ?? true,
    legacy,
    requiresApproval: legacy.requiresApproval,
    kind: legacy.kind
  };
};

export const UNIVERSAL_ACTION_REGISTRY: Record<Phase7RemediationAction, UniversalActionDefinition> =
  {
    RETRY_WEBHOOKS: fromLegacy("RETRY_WEBHOOKS", {
      providerType: "notification",
      riskLevel: "LOW",
      verificationStrategy: "NONE",
      rollbackCapability: "NONE",
      supportedEntityTypes: ["ALERT", "INCIDENT", "PROJECT"]
    }),
    RETRY_EMAILS: fromLegacy("RETRY_EMAILS", {
      providerType: "notification",
      riskLevel: "LOW",
      verificationStrategy: "NONE",
      rollbackCapability: "NONE",
      supportedEntityTypes: ["ALERT", "INCIDENT", "PROJECT"]
    }),
    RETRY_PAYMENT_VERIFICATION: fromLegacy("RETRY_PAYMENT_VERIFICATION", {
      providerType: "opswatch_native",
      riskLevel: "LOW",
      verificationStrategy: "NONE",
      rollbackCapability: "NONE",
      enabled: false,
      supportedAutomationModes: ["OBSERVE"],
      evidenceRequirements: ["explicitly_disabled_phase7"]
    }),
    REQUEUE_FAILED_JOB: fromLegacy("REQUEUE_FAILED_JOB", {
      providerType: "worker_remediator",
      riskLevel: "LOW",
      verificationStrategy: "PROVIDER_PLUS_HEALTH_CHECK",
      rollbackCapability: "NONE",
      requiredScopes: ["retry_failed_jobs"],
      supportedEntityTypes: ["PROJECT", "WORKER", "INCIDENT"]
    }),
    RERUN_HTTP_CHECK: fromLegacy("RERUN_HTTP_CHECK", {
      providerType: "opswatch_native",
      riskLevel: "LOW",
      verificationStrategy: "IMMEDIATE_CHECK_RESULT",
      rollbackCapability: "NONE",
      supportedEntityTypes: ["SERVICE", "CHECK", "ALERT", "INCIDENT"],
      timeoutMs: 30_000
    }),
    REVIEW_HTTP_EXPECTED_STATUS: fromLegacy("REVIEW_HTTP_EXPECTED_STATUS", {
      providerType: "opswatch_native",
      riskLevel: "HIGH",
      verificationStrategy: "EXPECTED_STATUS_RERUN",
      rollbackCapability: "REVERT_CHECK_EXPECTED_STATUS",
      supportedAutomationModes: ["OBSERVE", "APPROVAL"]
    }),
    RERUN_SSL_CHECK: fromLegacy("RERUN_SSL_CHECK", {
      providerType: "opswatch_native",
      riskLevel: "LOW",
      verificationStrategy: "IMMEDIATE_CHECK_RESULT",
      rollbackCapability: "NONE",
      supportedEntityTypes: ["SERVICE", "CHECK", "ALERT", "INCIDENT"]
    }),
    ACKNOWLEDGE_INCIDENT: fromLegacy("ACKNOWLEDGE_INCIDENT", {
      providerType: "opswatch_native",
      riskLevel: "LOW",
      verificationStrategy: "NONE",
      rollbackCapability: "NONE",
      supportedEntityTypes: ["INCIDENT"]
    }),
    ADD_INCIDENT_NOTE: fromLegacy("ADD_INCIDENT_NOTE", {
      providerType: "opswatch_native",
      riskLevel: "LOW",
      verificationStrategy: "NONE",
      rollbackCapability: "NONE",
      supportedEntityTypes: ["INCIDENT"]
    }),
    RESTART_WORKER: fromLegacy("RESTART_WORKER", {
      providerType: "worker_remediator",
      riskLevel: "MEDIUM",
      verificationStrategy: "PROVIDER_PLUS_HEALTH_CHECK",
      rollbackCapability: "MANUAL_OPERATOR",
      requiredScopes: ["restart_sync_worker"],
      supportedEntityTypes: ["PROJECT", "WORKER", "INCIDENT", "RELATIONSHIP"],
      supportedAutomationModes: ["OBSERVE", "APPROVAL"]
    }),
    RESTART_SERVICE: fromLegacy("RESTART_SERVICE", {
      providerType: "service_remediator",
      riskLevel: "MEDIUM",
      verificationStrategy: "PROVIDER_PLUS_HEALTH_CHECK",
      rollbackCapability: "MANUAL_OPERATOR",
      requiredScopes: ["restart_service"],
      supportedAutomationModes: ["OBSERVE", "APPROVAL"]
    }),
    ROLLBACK_DEPLOYMENT: fromLegacy("ROLLBACK_DEPLOYMENT", {
      providerType: "deployment_remediator",
      riskLevel: "HIGH",
      verificationStrategy: "PROVIDER_PLUS_HEALTH_CHECK",
      rollbackCapability: "REMEDIATOR_ROLLBACK_DEPLOYMENT",
      requiredScopes: ["rollback_deployment"],
      supportedAutomationModes: ["OBSERVE", "APPROVAL"]
    }),
    DISABLE_INTEGRATION: fromLegacy("DISABLE_INTEGRATION", {
      providerType: "notification",
      riskLevel: "MEDIUM",
      verificationStrategy: "CHANNEL_STATE",
      rollbackCapability: "MANUAL_OPERATOR",
      supportedAutomationModes: ["OBSERVE", "APPROVAL"]
    }),
    ROTATE_WEBHOOK_SECRET: fromLegacy("ROTATE_WEBHOOK_SECRET", {
      providerType: "opswatch_native",
      riskLevel: "HIGH",
      verificationStrategy: "NONE",
      rollbackCapability: "MANUAL_OPERATOR",
      supportedAutomationModes: ["OBSERVE", "APPROVAL"]
    }),
    CHECK_PROVIDER_STATUS: fromLegacy("CHECK_PROVIDER_STATUS", {
      providerType: "support",
      riskLevel: "LOW",
      verificationStrategy: "NONE",
      rollbackCapability: "NONE",
      kind: "support"
    }),
    OPEN_RUNBOOK: fromLegacy("OPEN_RUNBOOK", {
      providerType: "support",
      riskLevel: "LOW",
      verificationStrategy: "NONE",
      rollbackCapability: "NONE",
      kind: "support"
    }),
    REQUEST_HUMAN_REVIEW: fromLegacy("REQUEST_HUMAN_REVIEW", {
      providerType: "support",
      riskLevel: "LOW",
      verificationStrategy: "NONE",
      rollbackCapability: "NONE",
      kind: "support",
      supportedEntityTypes: ["INCIDENT"]
    }),

    TEST_CONNECTION: {
      actionKey: "TEST_CONNECTION",
      displayName: "Test connection",
      description: "Run the agentless connection probe and record health evidence.",
      providerType: "connection",
      supportedEntityTypes: ["CONNECTION", "PROJECT", "ALERT", "RELATIONSHIP"],
      supportedRelationshipTypes: ["DEPENDENCY", "SYNC", "INGEST"],
      requiredConnectionMode: null,
      requiredScopes: ["connection:test"],
      riskLevel: "LOW",
      supportedAutomationModes: ["OBSERVE", "APPROVAL", "AUTONOMOUS"],
      inputSchema: {
        type: "object",
        properties: {
          organizationId: { type: "string" },
          connectionId: { type: "string" },
          projectId: { type: "string" }
        },
        required: ["organizationId", "connectionId"]
      },
      timeoutMs: 30_000,
      retryPolicy: defaultRetry(1),
      rateLimit: defaultRate(60, 2),
      circuitBreakerPolicy: defaultCircuit(),
      maintenanceWindowBehaviour: "ALLOW_LOW_RISK",
      rollbackCapability: "NONE",
      verificationStrategy: "CONNECTION_TEST",
      evidenceRequirements: ["connection_probe_result", "health_status"],
      enabled: true,
      requiresApproval: false,
      kind: "fix"
    },
    REFRESH_CONNECTION_STATUS: {
      actionKey: "REFRESH_CONNECTION_STATUS",
      displayName: "Refresh connection status",
      description: "Re-read connection health and validation timestamps without mutating credentials.",
      providerType: "connection",
      supportedEntityTypes: ["CONNECTION", "PROJECT", "RELATIONSHIP"],
      supportedRelationshipTypes: ["DEPENDENCY", "SYNC", "INGEST"],
      requiredConnectionMode: null,
      requiredScopes: ["connection:read"],
      riskLevel: "LOW",
      supportedAutomationModes: ["OBSERVE", "APPROVAL", "AUTONOMOUS"],
      inputSchema: {
        type: "object",
        properties: {
          organizationId: { type: "string" },
          connectionId: { type: "string" }
        },
        required: ["organizationId", "connectionId"]
      },
      timeoutMs: 15_000,
      retryPolicy: defaultRetry(0),
      rateLimit: defaultRate(120, 3),
      circuitBreakerPolicy: defaultCircuit(),
      maintenanceWindowBehaviour: "ALLOW_LOW_RISK",
      rollbackCapability: "NONE",
      verificationStrategy: "CONNECTION_TEST",
      evidenceRequirements: ["connection_health_snapshot"],
      enabled: true,
      requiresApproval: false,
      kind: "fix"
    },
    REENABLE_CONNECTION: {
      actionKey: "REENABLE_CONNECTION",
      displayName: "Re-enable connection",
      description: "Re-activate a disabled connection and verify with a fresh probe.",
      providerType: "connection",
      supportedEntityTypes: ["CONNECTION", "PROJECT", "ALERT", "RELATIONSHIP"],
      supportedRelationshipTypes: ["DEPENDENCY", "SYNC", "INGEST"],
      requiredConnectionMode: null,
      requiredScopes: ["connection:write"],
      riskLevel: "MEDIUM",
      supportedAutomationModes: ["OBSERVE", "APPROVAL"],
      inputSchema: {
        type: "object",
        properties: {
          organizationId: { type: "string" },
          connectionId: { type: "string" }
        },
        required: ["organizationId", "connectionId"]
      },
      timeoutMs: 45_000,
      retryPolicy: defaultRetry(1),
      rateLimit: defaultRate(10, 1),
      circuitBreakerPolicy: defaultCircuit(),
      maintenanceWindowBehaviour: "REQUIRE_APPROVAL",
      rollbackCapability: "MANUAL_OPERATOR",
      verificationStrategy: "CONNECTION_TEST",
      evidenceRequirements: ["connection_active", "connection_probe_result"],
      enabled: true,
      requiresApproval: true,
      kind: "fix"
    },
    REQUEST_FRESH_HEARTBEAT: {
      actionKey: "REQUEST_FRESH_HEARTBEAT",
      displayName: "Request fresh heartbeat",
      description:
        "Record a heartbeat freshness request and verify subsequent ingest heartbeats resume.",
      providerType: "opswatch_native",
      supportedEntityTypes: ["PROJECT", "SERVICE", "ALERT", "INCIDENT"],
      supportedRelationshipTypes: ["HEARTBEAT"],
      requiredConnectionMode: null,
      requiredScopes: ["heartbeat:request"],
      riskLevel: "LOW",
      supportedAutomationModes: ["OBSERVE", "APPROVAL", "AUTONOMOUS"],
      inputSchema: {
        type: "object",
        properties: {
          organizationId: { type: "string" },
          projectId: { type: "string" },
          serviceId: { type: "string" }
        },
        required: ["organizationId", "projectId"]
      },
      timeoutMs: 20_000,
      retryPolicy: defaultRetry(0),
      rateLimit: defaultRate(30, 1),
      circuitBreakerPolicy: defaultCircuit(),
      maintenanceWindowBehaviour: "ALLOW_LOW_RISK",
      rollbackCapability: "NONE",
      verificationStrategy: "HEARTBEAT_RESUME",
      evidenceRequirements: ["heartbeat_request_audit", "fresh_heartbeat_observed"],
      enabled: true,
      requiresApproval: false,
      kind: "fix"
    }
  };

export const listUniversalActions = (): UniversalActionDefinition[] =>
  Object.values(UNIVERSAL_ACTION_REGISTRY).filter((action) => action.enabled);

export const getUniversalAction = (
  actionKey: string
): UniversalActionDefinition | null => {
  const key = actionKey as Phase7RemediationAction;
  const def = UNIVERSAL_ACTION_REGISTRY[key];
  return def ?? null;
};

export const isPhase7Action = (actionKey: string): actionKey is Phase7RemediationAction =>
  Object.prototype.hasOwnProperty.call(UNIVERSAL_ACTION_REGISTRY, actionKey);

export const mapRiskToAvailabilityHint = (
  def: UniversalActionDefinition,
  mode: RemediationAutomationMode
): RemediationAvailabilityState | null => {
  if (!def.enabled) return "NO_AUTOMATED_FIX";
  if (def.riskLevel === "CRITICAL") return "NO_AUTOMATED_FIX";
  if (mode === "OBSERVE") return "OBSERVE_ONLY";
  if (def.requiresApproval || !def.supportedAutomationModes.includes(mode)) {
    if (mode === "AUTONOMOUS" && def.riskLevel !== "LOW") return "APPROVAL_REQUIRED";
  }
  return null;
};

/** Re-export legacy helpers so callers can migrate imports gradually. */
export {
  REMEDIATION_REGISTRY,
  getActionState,
  requiresApproval,
  validateContext,
  scoreActionConfidence
} from "./actions";
export type { RemediationAction, ActionDef, ActionState } from "./actions";
