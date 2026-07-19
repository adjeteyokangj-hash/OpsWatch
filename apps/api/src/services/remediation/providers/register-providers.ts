/**
 * Provider adapters that declare remediation capabilities through one interface.
 */
import {
  getUniversalAction,
  listUniversalActions,
  type Phase7RemediationAction
} from "../action-registry";
import { resolveActionAvailability } from "../availability.service";
import {
  registerRemediationProvider,
  type RemediationCapability,
  type RemediationProviderAdapter,
  type RemediationValidationResult,
  type RemediationVerificationResult,
  type RemediationRollbackResult,
  type ProposedRemediationAction,
  type ApprovedRemediationAction,
  type ExecutedRemediationAction
} from "../provider-adapter";
import type { RemediationContext, RemediationExecutionResult } from "../types";
import { prisma } from "../../../lib/prisma";
import type { RemediationAction } from "../actions";

// Lazy import avoids circular init with remediation.service → executors.
const loadExecuteRemediation = async () => {
  const mod = await import("../remediation.service");
  return mod.executeRemediation;
};

const toCapability = (
  actionKey: Phase7RemediationAction,
  available: boolean,
  unavailableReason?: string
): RemediationCapability | null => {
  const def = getUniversalAction(actionKey);
  if (!def || !def.enabled) return null;
  return {
    actionKey: def.actionKey,
    displayName: def.displayName,
    riskLevel: def.riskLevel,
    requiresApproval: def.requiresApproval,
    requiredScopes: def.requiredScopes,
    verificationStrategy: def.verificationStrategy,
    rollbackCapability: def.rollbackCapability,
    available,
    unavailableReason
  };
};

const validateWithAvailability = (
  context: RemediationContext,
  action: ProposedRemediationAction,
  automationMode?: string
): RemediationValidationResult => {
  const availability = resolveActionAvailability({
    actionKey: action.actionKey,
    context: {
      ...context,
      extra: { ...(context.extra ?? {}), ...(action.input ?? {}) }
    },
    automationMode
  });
  if (!availability) {
    return {
      valid: false,
      availabilityState: "NO_AUTOMATED_FIX",
      reason: "Action is not registered or is disabled."
    };
  }
  return {
    valid: availability.state === "READY" || availability.state === "APPROVAL_REQUIRED",
    availabilityState: availability.state,
    reason: availability.reason,
    missingScopes:
      availability.state === "SETUP_REQUIRED" ? availability.requiredScopes : undefined
  };
};

const executeViaRegistry = async (
  context: RemediationContext,
  action: ApprovedRemediationAction
): Promise<RemediationExecutionResult> => {
  const executeRemediation = await loadExecuteRemediation();
  const merged: RemediationContext = {
    ...context,
    extra: {
      ...(context.extra ?? {}),
      ...(action.input ?? {}),
      correlationId: action.correlationId,
      approvalId: action.approvalId
    }
  };
  const output = await executeRemediation(action.actionKey as RemediationAction, merged, {
    approved: Boolean(action.approvalId || action.approvedBy),
    executedBy: action.approvedBy,
    executionMode: action.approvalId || action.approvedBy ? "APPROVED" : "MANUAL"
  });
  return output.result;
};

const defaultVerify = async (
  context: RemediationContext,
  action: ExecutedRemediationAction
): Promise<RemediationVerificationResult> => {
  const def = getUniversalAction(action.actionKey);
  if (!def) {
    return {
      state: "VERIFICATION_FAILED",
      summary: "Unknown action — cannot verify.",
      evidence: {}
    };
  }

  switch (def.verificationStrategy) {
    case "CONNECTION_TEST": {
      const connectionId =
        (typeof action.input?.connectionId === "string" && action.input.connectionId) ||
        (typeof context.extra?.connectionId === "string" && context.extra.connectionId) ||
        context.integrationId;
      if (!connectionId) {
        return {
          state: "VERIFICATION_FAILED",
          summary: "No connectionId for verification.",
          evidence: {}
        };
      }
      const row = await prisma.connection.findFirst({
        where: { id: connectionId, organizationId: context.organizationId },
        select: { id: true, isActive: true, health: true, lastSuccessAt: true }
      });
      if (row?.isActive && row.health === "HEALTHY") {
        return {
          state: "VERIFIED_HEALTHY",
          summary: "Connection is active and healthy.",
          evidence: {
            connectionId: row.id,
            health: row.health,
            lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null
          }
        };
      }
      return {
        state: "VERIFICATION_FAILED",
        summary: "Connection is not healthy after remediation.",
        evidence: {
          connectionId: row?.id ?? connectionId,
          health: row?.health ?? null,
          isActive: row?.isActive ?? null
        }
      };
    }
    case "IMMEDIATE_CHECK_RESULT": {
      if (!context.projectId && !context.serviceId) {
        return {
          state: "PARTIALLY_RECOVERED",
          summary: "Check re-run completed; project/service scope incomplete for follow-up evidence.",
          evidence: { providerResult: action.providerResult ?? {} }
        };
      }
      const since = new Date(Date.now() - 15 * 60_000);
      const pass = await prisma.checkResult.findFirst({
        where: {
          status: "PASS",
          checkedAt: { gte: since },
          Check: {
            ...(context.serviceId ? { serviceId: context.serviceId } : {}),
            ...(context.projectId ? { Service: { projectId: context.projectId } } : {})
          }
        },
        orderBy: { checkedAt: "desc" },
        select: { id: true, checkedAt: true, status: true }
      });
      if (pass) {
        return {
          state: "VERIFIED_HEALTHY",
          summary: "Recent PASS check result observed.",
          evidence: {
            checkResultId: pass.id,
            checkedAt: pass.checkedAt.toISOString()
          }
        };
      }
      return {
        state: "VERIFICATION_FAILED",
        summary: "No recent PASS check result after execution.",
        evidence: {}
      };
    }
    case "HEARTBEAT_RESUME": {
      if (!context.projectId) {
        return {
          state: "VERIFICATION_FAILED",
          summary: "projectId required to verify heartbeat resume.",
          evidence: {}
        };
      }
      const requestedAtRaw = action.providerResult?.requestedAt;
      const since =
        typeof requestedAtRaw === "string"
          ? new Date(requestedAtRaw)
          : new Date(Date.now() - 5 * 60_000);
      const hb = await prisma.heartbeat.findFirst({
        where: {
          projectId: context.projectId,
          receivedAt: { gt: since },
          status: { in: ["ok", "OK", "healthy", "HEALTHY", "UP"] }
        },
        orderBy: { receivedAt: "desc" },
        select: { id: true, receivedAt: true, status: true }
      });
      if (hb) {
        return {
          state: "VERIFIED_HEALTHY",
          summary: "Fresh heartbeat observed after request.",
          evidence: {
            heartbeatId: hb.id,
            receivedAt: hb.receivedAt.toISOString(),
            status: hb.status
          }
        };
      }
      return {
        state: "VERIFICATION_FAILED",
        summary: "No fresh healthy heartbeat observed after request.",
        evidence: { since: since.toISOString() }
      };
    }
    case "PROVIDER_PLUS_HEALTH_CHECK": {
      const providerVerified =
        action.providerResult?.verified === true ||
        action.providerResult?.verificationStatus === "healthy" ||
        action.providerResult?.healthy === true;
      if (providerVerified && context.projectId) {
        const since = new Date(Date.now() - 15 * 60_000);
        const pass = await prisma.checkResult.findFirst({
          where: {
            status: "PASS",
            checkedAt: { gte: since },
            Check: { Service: { projectId: context.projectId } }
          },
          select: { id: true }
        });
        if (pass) {
          return {
            state: "VERIFIED_HEALTHY",
            summary: "Provider reported healthy and OpsWatch observed a PASS check.",
            evidence: { checkResultId: pass.id, providerVerified: true }
          };
        }
        return {
          state: "PARTIALLY_RECOVERED",
          summary: "Provider reported healthy but OpsWatch has not yet observed a PASS check.",
          evidence: { providerVerified: true }
        };
      }
      return {
        state: "VERIFICATION_FAILED",
        summary:
          "Provider response alone is insufficient — independent health evidence was not observed.",
        evidence: { providerResult: action.providerResult ?? {} }
      };
    }
    case "NONE":
    default:
      return {
        state: "VERIFIED_HEALTHY",
        summary: "Action completed; no independent health verification required for this action kind.",
        evidence: { providerResult: action.providerResult ?? {} }
      };
  }
};

const createAdapter = (
  providerKey: string,
  actionKeys: Phase7RemediationAction[]
): RemediationProviderAdapter => ({
  providerKey,
  async listCapabilities(context) {
    const caps: RemediationCapability[] = [];
    for (const actionKey of actionKeys) {
      const availability = resolveActionAvailability({
        actionKey,
        context,
        automationMode: "APPROVAL"
      });
      const cap = toCapability(
        actionKey,
        availability?.state === "READY" || availability?.state === "APPROVAL_REQUIRED",
        availability?.reason
      );
      if (cap) caps.push(cap);
    }
    return caps;
  },
  async validateAction(context, action) {
    return validateWithAvailability(context, action);
  },
  async executeAction(context, action) {
    return executeViaRegistry(context, action);
  },
  async verifyAction(context, action) {
    return defaultVerify(context, action);
  },
  async rollbackAction(context, action): Promise<RemediationRollbackResult> {
    const def = getUniversalAction(action.actionKey);
    if (!def || def.rollbackCapability === "NONE") {
      return {
        state: "NONE",
        summary: "No automated rollback for this action.",
        evidence: {}
      };
    }
    if (def.rollbackCapability === "REVERT_CHECK_EXPECTED_STATUS") {
      // REVIEW_HTTP_EXPECTED_STATUS executor already rolls back on failed verify.
      return {
        state: "ROLLED_BACK",
        summary: "Expected HTTP status rollback is handled by the action executor on verification failure.",
        evidence: {}
      };
    }
    if (def.rollbackCapability === "REMEDIATOR_ROLLBACK_DEPLOYMENT") {
      const executeRemediation = await loadExecuteRemediation();
      const output = await executeRemediation("ROLLBACK_DEPLOYMENT", context, {
        approved: true,
        executedBy: action.approvedBy,
        executionMode: "APPROVED"
      });
      return {
        state: output.result.success ? "ROLLED_BACK" : "ROLLBACK_FAILED",
        summary: output.result.summary,
        evidence: (output.result.details ?? {}) as Record<string, unknown>
      };
    }
    return {
      state: "NONE",
      summary: "Rollback requires manual operator action.",
      evidence: {}
    };
  }
});

let registered = false;

export const ensureRemediationProvidersRegistered = (): void => {
  if (registered) return;
  registered = true;

  const byProvider = new Map<string, Phase7RemediationAction[]>();
  for (const def of listUniversalActions()) {
    const list = byProvider.get(def.providerType) ?? [];
    list.push(def.actionKey);
    byProvider.set(def.providerType, list);
  }
  for (const [providerKey, actionKeys] of byProvider) {
    registerRemediationProvider(createAdapter(providerKey, actionKeys));
  }
};

export const resetRemediationProviderRegistrationForTests = (): void => {
  registered = false;
};
