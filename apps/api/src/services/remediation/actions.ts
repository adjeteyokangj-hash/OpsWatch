export type RemediationAction =
  | "RETRY_WEBHOOKS"
  | "RETRY_EMAILS"
  | "RETRY_PAYMENT_VERIFICATION"
  | "REQUEUE_FAILED_JOB"
  | "RERUN_HTTP_CHECK"
  | "RERUN_SSL_CHECK"
  | "ACKNOWLEDGE_INCIDENT"
  | "ADD_INCIDENT_NOTE"
  | "RESTART_WORKER"
  | "RESTART_SERVICE"
  | "ROLLBACK_DEPLOYMENT"
  | "DISABLE_INTEGRATION"
  | "ROTATE_WEBHOOK_SECRET"
  | "CHECK_PROVIDER_STATUS"
  | "OPEN_RUNBOOK"
  | "REQUEST_HUMAN_REVIEW";

export type ActionGroup = "GROUP_A_SAFE" | "GROUP_B_APPROVAL" | "GROUP_C_SUPPORT";
export type PolicyTier = "SAFE_AUTOMATIC" | "APPROVAL_REQUIRED" | "MANUAL_ONLY";
export type ConfidenceLabel = "HIGH" | "MEDIUM" | "LOW" | "BLOCKED";
export type ImpactTier = "LOW" | "MEDIUM" | "HIGH";

import type { IntegrationType } from "@prisma/client";

export interface ActionDef {
  label: string;
  description: string;
  group: ActionGroup;
  requiresApproval: boolean;
  policyTier: PolicyTier;
  /** Blast radius: how disruptive this action could be if it misfires. */
  impactTier: ImpactTier;
  /** `fix` actions are true remediation, `support` actions aid diagnosis/escalation. */
  kind: "fix" | "support";
  /**
   * Fields that must be truthy in RemediationContext before this action can execute.
   * Absence of any listed field → MISSING_CONTEXT state.
   */
  requiredContextFields: (keyof import("./types").RemediationContext)[];
  /**
   * Environment variable names that must be set for this action to be operable.
   * Absence of any → MISCONFIGURED_ENV state.
   */
  requiredEnvVars: string[];
  /**
   * Project-scoped integration requirement.
   * If provided, validation checks project integration config before falling back
   * to process.env for backward compatibility.
   */
  requiredIntegration?: {
    type: IntegrationType;
    requiredConfigKeys: string[];
  };
}

export interface IntegrationConfigInput {
  type: IntegrationType;
  enabled: boolean;
  configJson?: Record<string, unknown> | null;
  validationStatus?: "UNKNOWN" | "VALID" | "INVALID";
  lastValidatedAt?: Date | string | null;
}

export const REMEDIATION_REGISTRY: Record<RemediationAction, ActionDef> = {
  // Group A — safe and executable now
  RETRY_WEBHOOKS: {
    label: "Retry webhooks",
    description: "Replay failed outbound webhook deliveries.",
    group: "GROUP_A_SAFE",
    requiresApproval: false,
    policyTier: "SAFE_AUTOMATIC",
    impactTier: "LOW",
    kind: "fix",
    requiredContextFields: [],
    requiredEnvVars: []
  },
  RETRY_EMAILS: {
    label: "Retry emails",
    description: "Replay failed email notifications.",
    group: "GROUP_A_SAFE",
    requiresApproval: false,
    policyTier: "SAFE_AUTOMATIC",
    impactTier: "LOW",
    kind: "fix",
    requiredContextFields: [],
    requiredEnvVars: []
  },
  RETRY_PAYMENT_VERIFICATION: {
    label: "Retry payment verification",
    description: "Re-run payment verification for failed/uncertain payment events.",
    group: "GROUP_A_SAFE",
    requiresApproval: false,
    policyTier: "SAFE_AUTOMATIC",
    impactTier: "LOW",
    kind: "fix",
    requiredContextFields: [],
    requiredEnvVars: ["PAYMENT_VERIFICATION_ENDPOINT"],
    requiredIntegration: {
      type: "STRIPE",
      requiredConfigKeys: ["PAYMENT_VERIFICATION_ENDPOINT"]
    }
  },
  REQUEUE_FAILED_JOB: {
    label: "Requeue failed jobs",
    description: "Push failed worker jobs back onto the queue.",
    group: "GROUP_A_SAFE",
    requiresApproval: false,
    policyTier: "SAFE_AUTOMATIC",
    impactTier: "LOW",
    kind: "fix",
    requiredContextFields: [],
    requiredEnvVars: ["JOB_REQUEUE_ENDPOINT"]
  },
  RERUN_HTTP_CHECK: {
    label: "Rerun HTTP check",
    description: "Run the affected HTTP/keyword/latency check immediately.",
    group: "GROUP_A_SAFE",
    requiresApproval: false,
    policyTier: "SAFE_AUTOMATIC",
    impactTier: "LOW",
    kind: "fix",
    requiredContextFields: ["serviceId"],
    requiredEnvVars: []
  },
  RERUN_SSL_CHECK: {
    label: "Rerun SSL check",
    description: "Run SSL certificate validation immediately.",
    group: "GROUP_A_SAFE",
    requiresApproval: false,
    policyTier: "SAFE_AUTOMATIC",
    impactTier: "LOW",
    kind: "fix",
    requiredContextFields: ["serviceId"],
    requiredEnvVars: []
  },
  ACKNOWLEDGE_INCIDENT: {
    label: "Acknowledge incident",
    description: "Mark the incident as acknowledged and move to investigation.",
    group: "GROUP_A_SAFE",
    requiresApproval: false,
    policyTier: "SAFE_AUTOMATIC",
    impactTier: "LOW",
    kind: "fix",
    requiredContextFields: ["incidentId"],
    requiredEnvVars: []
  },
  ADD_INCIDENT_NOTE: {
    label: "Add incident note",
    description: "Write a structured incident response note.",
    group: "GROUP_A_SAFE",
    requiresApproval: false,
    policyTier: "SAFE_AUTOMATIC",
    impactTier: "LOW",
    kind: "fix",
    requiredContextFields: ["incidentId"],
    requiredEnvVars: []
  },

  // Group B — real actions requiring approval
  RESTART_WORKER: {
    label: "Restart worker",
    description: "Trigger worker restart through provider integration.",
    group: "GROUP_B_APPROVAL",
    requiresApproval: true,
    policyTier: "APPROVAL_REQUIRED",
    impactTier: "MEDIUM",
    kind: "fix",
    requiredContextFields: [],
    requiredEnvVars: ["WORKER_RESTART_WEBHOOK_URL"],
    requiredIntegration: {
      type: "WORKER_PROVIDER",
      requiredConfigKeys: ["WORKER_RESTART_WEBHOOK_URL"]
    }
  },
  RESTART_SERVICE: {
    label: "Restart service",
    description: "Trigger service restart through provider integration.",
    group: "GROUP_B_APPROVAL",
    requiresApproval: true,
    policyTier: "APPROVAL_REQUIRED",
    impactTier: "MEDIUM",
    kind: "fix",
    requiredContextFields: ["serviceId"],
    requiredEnvVars: ["SERVICE_RESTART_WEBHOOK_URL"],
    requiredIntegration: {
      type: "SERVICE_PROVIDER",
      requiredConfigKeys: ["SERVICE_RESTART_WEBHOOK_URL"]
    }
  },
  ROLLBACK_DEPLOYMENT: {
    label: "Rollback deployment",
    description: "Trigger deployment rollback through provider integration.",
    group: "GROUP_B_APPROVAL",
    requiresApproval: true,
    policyTier: "APPROVAL_REQUIRED",
    impactTier: "HIGH",
    kind: "fix",
    requiredContextFields: ["projectId"],
    requiredEnvVars: ["DEPLOYMENT_ROLLBACK_WEBHOOK_URL"],
    requiredIntegration: {
      type: "DEPLOYMENT_PROVIDER",
      requiredConfigKeys: ["DEPLOYMENT_ROLLBACK_WEBHOOK_URL"]
    }
  },
  DISABLE_INTEGRATION: {
    label: "Disable integration",
    description: "Temporarily disable a noisy/broken integration.",
    group: "GROUP_B_APPROVAL",
    requiresApproval: true,
    policyTier: "APPROVAL_REQUIRED",
    impactTier: "MEDIUM",
    kind: "fix",
    requiredContextFields: ["integrationId"],
    requiredEnvVars: []
  },
  ROTATE_WEBHOOK_SECRET: {
    label: "Rotate webhook secret",
    description: "Rotate signing secret for webhook ingestion.",
    group: "GROUP_B_APPROVAL",
    requiresApproval: true,
    policyTier: "APPROVAL_REQUIRED",
    impactTier: "MEDIUM",
    kind: "fix",
    requiredContextFields: ["projectId"],
    requiredEnvVars: []
  },

  // Group C — support/diagnostic, not direct fixes
  CHECK_PROVIDER_STATUS: {
    label: "Check provider status",
    description: "Fetch provider status and attach context for responders.",
    group: "GROUP_C_SUPPORT",
    requiresApproval: false,
    policyTier: "MANUAL_ONLY",
    impactTier: "LOW",
    kind: "support",
    requiredContextFields: [],
    requiredEnvVars: ["PROVIDER_STATUS_URL"],
    requiredIntegration: {
      type: "STATUS_PROVIDER",
      requiredConfigKeys: ["PROVIDER_STATUS_URL"]
    }
  },
  OPEN_RUNBOOK: {
    label: "Open runbook",
    description: "Return runbook URL for the incident workflow.",
    group: "GROUP_C_SUPPORT",
    requiresApproval: false,
    policyTier: "MANUAL_ONLY",
    impactTier: "LOW",
    kind: "support",
    requiredContextFields: [],
    requiredEnvVars: ["RUNBOOK_BASE_URL"],
    requiredIntegration: {
      type: "RUNBOOK_PROVIDER",
      requiredConfigKeys: ["RUNBOOK_BASE_URL"]
    }
  },
  REQUEST_HUMAN_REVIEW: {
    label: "Request human review",
    description: "Escalate incident for manual review/on-call response.",
    group: "GROUP_C_SUPPORT",
    requiresApproval: false,
    policyTier: "MANUAL_ONLY",
    impactTier: "LOW",
    kind: "support",
    requiredContextFields: ["incidentId"],
    requiredEnvVars: []
  }
};

export const requiresApproval = (action: RemediationAction): boolean =>
  REMEDIATION_REGISTRY[action]?.requiresApproval ?? false;

// ---------------------------------------------------------------------------
// Context validation
// ---------------------------------------------------------------------------

import type { RemediationContext } from "./types";

export interface ContextValidationResult {
  valid: boolean;
  missingFields: string[];
  missingEnvVars: string[];
  invalidIntegration: boolean;
}

/**
 * Validates that all required context fields and env vars are present for the
 * given action. Returns a structured result so callers can provide precise
 * feedback rather than a generic "unsupported" message.
 */
export function validateContext(
  action: RemediationAction,
  context: RemediationContext,
  integrations: IntegrationConfigInput[] = []
): ContextValidationResult {
  const def = REMEDIATION_REGISTRY[action];
  const missingFields = def.requiredContextFields.filter(
    (field) => !context[field]
  ) as string[];

  let invalidIntegration = false;
  let missingEnvVars: string[];
  if (def.requiredIntegration) {
    const integration = integrations.find(
      (candidate) => candidate.type === def.requiredIntegration?.type && candidate.enabled
    );
    if (!integration) {
      missingEnvVars = def.requiredIntegration.requiredConfigKeys;
    } else if (integration.validationStatus === "INVALID") {
      invalidIntegration = true;
      missingEnvVars = def.requiredIntegration.requiredConfigKeys;
    } else {
      missingEnvVars = def.requiredIntegration.requiredConfigKeys.filter((key) => {
        const fromConfig = integration.configJson?.[key];
        const fromEnv = process.env[key];
        return !fromConfig && !fromEnv;
      });
    }
  } else {
    missingEnvVars = def.requiredEnvVars.filter(
      (envVar) => !process.env[envVar]
    );
  }

  return {
    valid: missingFields.length === 0 && missingEnvVars.length === 0 && !invalidIntegration,
    missingFields,
    missingEnvVars,
    invalidIntegration
  };
}

export type ActionState =
  | "READY"
  | "APPROVAL_REQUIRED"
  | "MISSING_CONTEXT"
  | "MISCONFIGURED_ENV"
  | "UNSUPPORTED";

/**
 * Returns the operator-visible state for a given action + context combination.
 * Priority: MISCONFIGURED_ENV > MISSING_CONTEXT > APPROVAL_REQUIRED > READY.
 */
export function getActionState(
  action: RemediationAction,
  context: RemediationContext,
  integrations: IntegrationConfigInput[] = []
): ActionState {
  const { missingFields, missingEnvVars } = validateContext(action, context, integrations);
  if (missingEnvVars.length > 0) return "MISCONFIGURED_ENV";
  if (missingFields.length > 0) return "MISSING_CONTEXT";
  if (requiresApproval(action)) return "APPROVAL_REQUIRED";
  return "READY";
}

export interface ConfidenceFactor {
  name: string;
  impact: number; // +/- points added to score
  description: string;
  status: "pass" | "warn" | "fail"; // visual indicator
}

export interface ConfidenceBreakdown {
  confidenceScore: number;
  confidenceLabel: ConfidenceLabel;
  factors: ConfidenceFactor[];
}

/** @deprecated Use validateContext + getActionState instead. */
export const isActionConfigured = (action: RemediationAction): boolean =>
  validateContext(action, {} as RemediationContext, []).missingEnvVars.length === 0;

export function scoreActionConfidence(input: {
  action: RemediationAction;
  state: ActionState;
  severity?: string;
  integrationValidationStatus?: "UNKNOWN" | "VALID" | "INVALID";
  lastValidatedAt?: Date | string | null;
  historicalSuccessRate?: number | null;
}): ConfidenceBreakdown {
  const def = REMEDIATION_REGISTRY[input.action];
  const factors: ConfidenceFactor[] = [];

  if (input.state === "MISSING_CONTEXT" || input.state === "MISCONFIGURED_ENV") {
    factors.push({
      name: "Context validation",
      impact: -100,
      description: input.state === "MISSING_CONTEXT" ? "Required context fields missing" : "Required environment variables not set",
      status: "fail"
    });
    return {
      confidenceScore: 0,
      confidenceLabel: "BLOCKED",
      factors
    };
  }

  if (input.integrationValidationStatus === "INVALID") {
    factors.push({
      name: "Integration validation",
      impact: -100,
      description: "Required integration failed validation",
      status: "fail"
    });
    return {
      confidenceScore: 0,
      confidenceLabel: "BLOCKED",
      factors
    };
  }

  let score = 80;
  factors.push({
    name: "Base score",
    impact: 80,
    description: "Starting confidence for action state READY",
    status: "pass"
  });

  // Policy tier impact
  if (def.policyTier === "APPROVAL_REQUIRED") {
    score -= 15;
    factors.push({
      name: "Policy tier",
      impact: -15,
      description: "Action requires approval before execution",
      status: "warn"
    });
  } else if (def.policyTier === "MANUAL_ONLY") {
    score -= 25;
    factors.push({
      name: "Policy tier",
      impact: -25,
      description: "Action requires manual-only execution (no automation)",
      status: "fail"
    });
  } else {
    factors.push({
      name: "Policy tier",
      impact: 0,
      description: "Action is SAFE_AUTOMATIC (no policy penalty)",
      status: "pass"
    });
  }

  // Integration validation impact
  if (input.integrationValidationStatus === "VALID") {
    score += 10;
    factors.push({
      name: "Integration validation",
      impact: 10,
      description: "Required integration validated and operational",
      status: "pass"
    });
  } else if (input.integrationValidationStatus === "UNKNOWN") {
    score -= 10;
    factors.push({
      name: "Integration validation",
      impact: -10,
      description: "Integration validation status unknown",
      status: "warn"
    });
  }

  // Integration age impact
  if (input.lastValidatedAt) {
    const dt = new Date(input.lastValidatedAt);
    if (!Number.isNaN(dt.getTime())) {
      const ageMs = Date.now() - dt.getTime();
      const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
      if (ageMs > oneWeekMs) {
        score -= 5;
        const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        factors.push({
          name: "Integration freshness",
          impact: -5,
          description: `Integration last validated ${days} days ago`,
          status: "warn"
        });
      }
    }
  }

  // Historical success rate impact
  if (typeof input.historicalSuccessRate === "number") {
    const pct = Math.round(input.historicalSuccessRate * 100);
    if (input.historicalSuccessRate >= 0.8) {
      score += 10;
      factors.push({
        name: "Historical success rate",
        impact: 10,
        description: `${pct}% historical success rate (≥80%)`,
        status: "pass"
      });
    } else if (input.historicalSuccessRate < 0.5) {
      score -= 15;
      factors.push({
        name: "Historical success rate",
        impact: -15,
        description: `${pct}% historical success rate (<50%, unreliable)`,
        status: "fail"
      });
    } else {
      factors.push({
        name: "Historical success rate",
        impact: 0,
        description: `${pct}% historical success rate (50-80%, acceptable)`,
        status: "warn"
      });
    }
  } else {
    score -= 10;
    factors.push({
      name: "Historical success rate",
      impact: -10,
      description: "No historical execution data available (conservative penalty)",
      status: "fail"
    });
  }

  // Severity impact
  const severity = (input.severity || "").toUpperCase();
  if (severity === "CRITICAL") {
    score -= 10;
    factors.push({
      name: "Incident severity",
      impact: -10,
      description: "CRITICAL incidents reduce auto-run confidence (high risk)",
      status: "fail"
    });
  } else if (severity === "HIGH") {
    score -= 5;
    factors.push({
      name: "Incident severity",
      impact: -5,
      description: "HIGH severity incidents slightly reduce confidence",
      status: "warn"
    });
  } else if (severity === "LOW") {
    score += 5;
    factors.push({
      name: "Incident severity",
      impact: 5,
      description: "LOW severity allows higher confidence",
      status: "pass"
    });
  }

  score = Math.max(0, Math.min(100, score));

  let confidenceLabel: ConfidenceLabel;
  if (score >= 75) confidenceLabel = "HIGH";
  else if (score >= 50) confidenceLabel = "MEDIUM";
  else confidenceLabel = "LOW";

  return { confidenceScore: score, confidenceLabel, factors };
}
