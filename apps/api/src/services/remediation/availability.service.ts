/**
 * Resolve action availability for alerts, incidents, topology, and workers
 * through the universal action registry (Phase 7).
 */
import { normalizeProjectAutonomousMode, toAutomationRunExecutionMode } from "@opswatch/shared";
import {
  getUniversalAction,
  listUniversalActions,
  type Phase7RemediationAction,
  type UniversalActionDefinition,
  type RemediationAvailabilityState,
  type RemediationAutomationMode
} from "./action-registry";
import { validateContext } from "./actions";
import type { RemediationContext } from "./types";
import type { IntegrationConfigInput } from "./actions";
import { getRemediationProvider } from "./provider-adapter";

export type ActionAvailabilityResult = {
  actionKey: Phase7RemediationAction;
  displayName: string;
  state: RemediationAvailabilityState;
  reason: string;
  riskLevel: string;
  requiresApproval: boolean;
  providerType: string;
  verificationStrategy: string;
  rollbackCapability: string;
  requiredScopes: string[];
  supportedAutomationModes: RemediationAutomationMode[];
};

const modeFromProject = (raw: string | null | undefined): RemediationAutomationMode => {
  const autonomous = normalizeProjectAutonomousMode(raw);
  return toAutomationRunExecutionMode(autonomous) as RemediationAutomationMode;
};

export const resolveActionAvailability = (input: {
  actionKey: string;
  context: RemediationContext;
  automationMode?: string | null;
  integrations?: IntegrationConfigInput[];
  circuitOpen?: boolean;
  circuitReason?: string;
  maintenanceBlocked?: boolean;
  maintenanceReason?: string;
  credentialValid?: boolean;
  credentialReason?: string;
  capabilityAvailable?: boolean;
  capabilityReason?: string;
}): ActionAvailabilityResult | null => {
  const def = getUniversalAction(input.actionKey);
  if (!def || !def.enabled) {
    return null;
  }

  const mode = modeFromProject(input.automationMode);
  const base = {
    actionKey: def.actionKey,
    displayName: def.displayName,
    riskLevel: def.riskLevel,
    requiresApproval: def.requiresApproval,
    providerType: def.providerType,
    verificationStrategy: def.verificationStrategy,
    rollbackCapability: def.rollbackCapability,
    requiredScopes: def.requiredScopes,
    supportedAutomationModes: def.supportedAutomationModes
  };

  if (def.riskLevel === "CRITICAL") {
    return {
      ...base,
      state: "NO_AUTOMATED_FIX",
      reason: "Critical-risk actions are unsupported in Phase 7."
    };
  }

  if (mode === "OBSERVE") {
    return {
      ...base,
      state: "OBSERVE_ONLY",
      reason: "Project automation mode is Observe — diagnosis and recommendation only; execution is prohibited."
    };
  }

  if (input.circuitOpen) {
    return {
      ...base,
      state: "BLOCKED",
      reason: input.circuitReason ?? "Action circuit breaker is open."
    };
  }

  if (input.maintenanceBlocked) {
    return {
      ...base,
      state: "BLOCKED",
      reason: input.maintenanceReason ?? "Maintenance window suppresses execution."
    };
  }

  if (input.credentialValid === false) {
    return {
      ...base,
      state: "SETUP_REQUIRED",
      reason: input.credentialReason ?? "Credential missing, expired, or revoked."
    };
  }

  if (input.capabilityAvailable === false) {
    return {
      ...base,
      state: "SETUP_REQUIRED",
      reason: input.capabilityReason ?? "Provider does not advertise this capability."
    };
  }

  const legacyKey = def.actionKey;
  if (
    legacyKey === "RETRY_WEBHOOKS" ||
    legacyKey === "RETRY_EMAILS" ||
    legacyKey === "REQUEUE_FAILED_JOB" ||
    legacyKey === "RERUN_HTTP_CHECK" ||
    legacyKey === "REVIEW_HTTP_EXPECTED_STATUS" ||
    legacyKey === "RERUN_SSL_CHECK" ||
    legacyKey === "ACKNOWLEDGE_INCIDENT" ||
    legacyKey === "ADD_INCIDENT_NOTE" ||
    legacyKey === "RESTART_WORKER" ||
    legacyKey === "RESTART_SERVICE" ||
    legacyKey === "ROLLBACK_DEPLOYMENT" ||
    legacyKey === "DISABLE_INTEGRATION" ||
    legacyKey === "ROTATE_WEBHOOK_SECRET" ||
    legacyKey === "CHECK_PROVIDER_STATUS" ||
    legacyKey === "OPEN_RUNBOOK" ||
    legacyKey === "REQUEST_HUMAN_REVIEW" ||
    legacyKey === "RETRY_PAYMENT_VERIFICATION"
  ) {
    const validation = validateContext(legacyKey, input.context, input.integrations ?? []);
    if (validation.missingEnvVars.length > 0 || validation.invalidIntegration) {
      return {
        ...base,
        state: "SETUP_REQUIRED",
        reason: validation.invalidIntegration
          ? "Required remediator/integration is missing or not validated."
          : `Setup required: missing ${validation.missingEnvVars.join(", ")}.`
      };
    }
    if (validation.missingFields.length > 0) {
      return {
        ...base,
        state: "SETUP_REQUIRED",
        reason: `Missing context: ${validation.missingFields.join(", ")}.`
      };
    }
  }

  if (
    (def.actionKey === "TEST_CONNECTION" ||
      def.actionKey === "REFRESH_CONNECTION_STATUS" ||
      def.actionKey === "REENABLE_CONNECTION") &&
    !(
      input.context.integrationId ||
      (typeof input.context.extra?.connectionId === "string" && input.context.extra.connectionId)
    )
  ) {
    return {
      ...base,
      state: "SETUP_REQUIRED",
      reason: "connectionId is required in context."
    };
  }

  if (mode === "AUTONOMOUS") {
    if (!def.supportedAutomationModes.includes("AUTONOMOUS") || def.riskLevel !== "LOW") {
      return {
        ...base,
        state: "APPROVAL_REQUIRED",
        reason:
          "Autonomous mode may only execute low-risk, pre-approved actions. This action requires approval."
      };
    }
  }

  if (def.requiresApproval || mode === "APPROVAL") {
    if (mode === "AUTONOMOUS" && def.riskLevel === "LOW" && !def.requiresApproval) {
      return {
        ...base,
        state: "READY",
        reason: "Low-risk action is ready for autonomous execution within policy limits."
      };
    }
    return {
      ...base,
      state: "APPROVAL_REQUIRED",
      reason: "Policy requires authorised approval before execution."
    };
  }

  return {
    ...base,
    state: "READY",
    reason: "Supported action with prerequisites satisfied."
  };
};

export const listAvailableActionsForContext = (input: {
  context: RemediationContext;
  automationMode?: string | null;
  integrations?: IntegrationConfigInput[];
  entityType?: string;
}): ActionAvailabilityResult[] => {
  const actions = listUniversalActions().filter((def) => {
    if (!input.entityType) return true;
    return def.supportedEntityTypes.includes(input.entityType as never);
  });

  return actions
    .map((def) =>
      resolveActionAvailability({
        actionKey: def.actionKey,
        context: input.context,
        automationMode: input.automationMode,
        integrations: input.integrations
      })
    )
    .filter((row): row is ActionAvailabilityResult => row !== null);
};

export const resolveProviderForAction = (
  def: UniversalActionDefinition
): string => def.providerType;

export const validateViaProviderAdapter = async (input: {
  actionKey: string;
  context: RemediationContext;
}): Promise<ActionAvailabilityResult | null> => {
  const def = getUniversalAction(input.actionKey);
  if (!def) return null;
  const provider = getRemediationProvider(def.providerType);
  if (!provider) {
    return resolveActionAvailability({
      actionKey: input.actionKey,
      context: input.context
    });
  }
  const validation = await provider.validateAction(input.context, {
    actionKey: def.actionKey
  });
  return {
    actionKey: def.actionKey,
    displayName: def.displayName,
    state: validation.availabilityState,
    reason: validation.reason,
    riskLevel: def.riskLevel,
    requiresApproval: def.requiresApproval,
    providerType: def.providerType,
    verificationStrategy: def.verificationStrategy,
    rollbackCapability: def.rollbackCapability,
    requiredScopes: def.requiredScopes,
    supportedAutomationModes: def.supportedAutomationModes
  };
};
