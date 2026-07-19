/**
 * Phase 7 capability-based remediation provider adapter.
 * All providers share governance and audit via the remediation run services.
 */
import type { RemediationContext, RemediationExecutionResult } from "./types";
import type { Phase7RemediationAction } from "./action-registry";

export type RemediationCapability = {
  actionKey: Phase7RemediationAction;
  displayName: string;
  riskLevel: string;
  requiresApproval: boolean;
  requiredScopes: string[];
  verificationStrategy: string;
  rollbackCapability: string;
  available: boolean;
  unavailableReason?: string;
};

export type ProposedRemediationAction = {
  actionKey: Phase7RemediationAction;
  input?: Record<string, unknown>;
};

export type ApprovedRemediationAction = ProposedRemediationAction & {
  approvalId?: string;
  correlationId: string;
  approvedBy?: string;
};

export type ExecutedRemediationAction = ApprovedRemediationAction & {
  executionRunId: string;
  providerResult?: Record<string, unknown>;
};

export type RemediationValidationResult = {
  valid: boolean;
  availabilityState:
    | "READY"
    | "APPROVAL_REQUIRED"
    | "SETUP_REQUIRED"
    | "BLOCKED"
    | "NO_AUTOMATED_FIX"
    | "OBSERVE_ONLY";
  reason: string;
  missingScopes?: string[];
  missingPrerequisites?: string[];
};

export type RemediationVerificationResult = {
  state:
    | "VERIFYING"
    | "VERIFIED_HEALTHY"
    | "PARTIALLY_RECOVERED"
    | "VERIFICATION_FAILED";
  summary: string;
  evidence: Record<string, unknown>;
};

export type RemediationRollbackResult = {
  state: "ROLLBACK_RUNNING" | "ROLLED_BACK" | "ROLLBACK_FAILED" | "NONE";
  summary: string;
  evidence: Record<string, unknown>;
};

export interface RemediationProviderAdapter {
  providerKey: string;

  listCapabilities(context: RemediationContext): Promise<RemediationCapability[]>;

  validateAction(
    context: RemediationContext,
    action: ProposedRemediationAction
  ): Promise<RemediationValidationResult>;

  executeAction(
    context: RemediationContext,
    action: ApprovedRemediationAction
  ): Promise<RemediationExecutionResult>;

  verifyAction(
    context: RemediationContext,
    action: ExecutedRemediationAction
  ): Promise<RemediationVerificationResult>;

  rollbackAction?(
    context: RemediationContext,
    action: ExecutedRemediationAction
  ): Promise<RemediationRollbackResult>;
}

export type ProviderRegistry = Map<string, RemediationProviderAdapter>;

const adapters: ProviderRegistry = new Map();

export const registerRemediationProvider = (adapter: RemediationProviderAdapter): void => {
  adapters.set(adapter.providerKey, adapter);
};

export const getRemediationProvider = (providerKey: string): RemediationProviderAdapter | null =>
  adapters.get(providerKey) ?? null;

export const listRemediationProviders = (): RemediationProviderAdapter[] =>
  Array.from(adapters.values());

export const clearRemediationProvidersForTests = (): void => {
  adapters.clear();
};
