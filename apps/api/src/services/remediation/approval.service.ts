import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { redactUnknown } from "../../lib/redact-secrets";
import { getUniversalAction } from "./action-registry";
import { resolveActionAvailability } from "./availability.service";
import type { RemediationContext } from "./types";
import { recordOperationsTimelineEvent } from "../intelligence/observation.service";
import { TIMELINE_EVENT } from "../intelligence/intelligence-constants";

const DEFAULT_APPROVAL_TTL_MS = Number(process.env.REMEDIATION_APPROVAL_TTL_MS || 60 * 60_000);

export type RemediationApprovalDecision = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

const emit = async (input: {
  organizationId: string;
  projectId?: string | null;
  correlationId: string;
  summary: string;
  payload?: Record<string, unknown>;
}) => {
  if (!input.projectId) return;
  try {
    await recordOperationsTimelineEvent({
      organizationId: input.organizationId,
      projectId: input.projectId,
      eventType: TIMELINE_EVENT.AUTOMATION_EXECUTED,
      summary: input.summary,
      sourceType: "REMEDIATION_APPROVAL",
      sourceId: input.correlationId,
      severity: "info",
      payloadJson: {
        correlationId: input.correlationId,
        ...(input.payload ?? {})
      }
    });
  } catch {
    // Timeline must not block approval.
  }
};

const loadProjectIntegrations = async (input: {
  organizationId: string;
  projectId?: string | null;
}): Promise<import("./actions").IntegrationConfigInput[]> => {
  if (!input.projectId) return [];
  const rows = await prisma.projectIntegration.findMany({
    where: {
      projectId: input.projectId,
      enabled: true,
      Project: { organizationId: input.organizationId }
    },
    select: {
      type: true,
      enabled: true,
      configJson: true,
      validationStatus: true,
      lastValidatedAt: true
    }
  });
  return rows.map((row) => ({
    type: row.type,
    enabled: row.enabled,
    configJson: (row.configJson as Record<string, unknown> | null) ?? null,
    validationStatus: row.validationStatus,
    lastValidatedAt: row.lastValidatedAt
  }));
};

export const requestRemediationApproval = async (input: {
  context: RemediationContext;
  actionKey: string;
  requestedBy?: string;
  reason: string;
  evidence?: Record<string, unknown>;
  expectedImpact?: string;
  automationMode?: string;
  ttlMs?: number;
}): Promise<{
  approvalId: string;
  correlationId: string;
  expiresAt: Date;
  state: string;
}> => {
  const def = getUniversalAction(input.actionKey);
  if (!def || !def.enabled) {
    throw new Error("Action is not registered or is disabled.");
  }

  let environment: string | null = null;
  if (input.context.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: input.context.projectId, organizationId: input.context.organizationId },
      select: { environment: true }
    });
    environment = project?.environment ?? null;
  }

  const integrations = await loadProjectIntegrations({
    organizationId: input.context.organizationId,
    projectId: input.context.projectId
  });

  const availability = resolveActionAvailability({
    actionKey: input.actionKey,
    context: input.context,
    automationMode: input.automationMode ?? "APPROVAL",
    integrations
  });
  if (availability?.state === "OBSERVE_ONLY") {
    throw new Error(availability.reason);
  }
  if (availability?.state === "NO_AUTOMATED_FIX" || availability?.state === "SETUP_REQUIRED") {
    throw new Error(availability?.reason ?? "Action is not available.");
  }

  const correlationId =
    (typeof input.context.extra?.correlationId === "string" && input.context.extra.correlationId) ||
    randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_APPROVAL_TTL_MS));
  const id = randomUUID();

  await prisma.remediationApproval.create({
    data: {
      id,
      organizationId: input.context.organizationId,
      projectId: input.context.projectId ?? null,
      environment,
      alertId: input.context.alertId ?? null,
      incidentId: input.context.incidentId ?? null,
      entityId:
        (typeof input.context.extra?.entityId === "string" && input.context.extra.entityId) || null,
      relationshipId:
        (typeof input.context.extra?.relationshipId === "string" &&
          input.context.extra.relationshipId) ||
        input.context.extra?.operationalRelationshipId?.toString() ||
        null,
      actionKey: input.actionKey,
      requestedBy: input.requestedBy ?? null,
      requestedAt: now,
      reason: input.reason,
      evidenceJson: redactUnknown(input.evidence ?? {}) as object,
      riskLevel: def.riskLevel,
      expectedImpact: input.expectedImpact ?? def.description,
      verificationMethod: def.verificationStrategy,
      rollbackMethod: def.rollbackCapability,
      expiresAt,
      decision: "PENDING",
      correlationId,
      updatedAt: now
    }
  });

  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: input.requestedBy ?? null,
      action: "REMEDIATION_APPROVAL_REQUESTED",
      entityType: "REMEDIATION_APPROVAL",
      entityId: id,
      metadataJson: redactUnknown({
        correlationId,
        actionKey: input.actionKey,
        organizationId: input.context.organizationId,
        projectId: input.context.projectId,
        riskLevel: def.riskLevel,
        expiresAt: expiresAt.toISOString()
      }) as object
    }
  });

  await emit({
    organizationId: input.context.organizationId,
    projectId: input.context.projectId,
    correlationId,
    summary: `Approval requested for ${def.displayName}`,
    payload: { actionKey: input.actionKey, approvalId: id }
  });

  return { approvalId: id, correlationId, expiresAt, state: "PENDING" };
};

export const decideRemediationApproval = async (input: {
  organizationId: string;
  approvalId: string;
  decision: "APPROVED" | "REJECTED";
  decidedBy: string;
  decisionReason: string;
}): Promise<{ approvalId: string; decision: string; correlationId: string }> => {
  const row = await prisma.remediationApproval.findFirst({
    where: { id: input.approvalId, organizationId: input.organizationId }
  });
  if (!row) throw new Error("Approval not found");
  if (row.decision !== "PENDING") throw new Error(`Approval already ${row.decision}`);

  const now = new Date();
  if (row.expiresAt.getTime() <= now.getTime()) {
    await prisma.remediationApproval.update({
      where: { id: row.id },
      data: {
        decision: "EXPIRED",
        decidedAt: now,
        decisionReason: "Approval expired before decision",
        updatedAt: now
      }
    });
    throw new Error("Approval has expired");
  }

  await prisma.remediationApproval.update({
    where: { id: row.id },
    data: {
      decision: input.decision,
      decidedBy: input.decidedBy,
      decidedAt: now,
      decisionReason: input.decisionReason,
      updatedAt: now
    }
  });

  const decidedByUser = await prisma.user.findUnique({
    where: { id: input.decidedBy },
    select: { id: true }
  });
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: decidedByUser?.id ?? null,
      action:
        input.decision === "APPROVED"
          ? "REMEDIATION_APPROVAL_GRANTED"
          : "REMEDIATION_APPROVAL_REJECTED",
      entityType: "REMEDIATION_APPROVAL",
      entityId: row.id,
      metadataJson: redactUnknown({
        correlationId: row.correlationId,
        actionKey: row.actionKey,
        decision: input.decision,
        decisionReason: input.decisionReason,
        decidedBy: input.decidedBy
      }) as object
    }
  });

  await emit({
    organizationId: input.organizationId,
    projectId: row.projectId,
    correlationId: row.correlationId,
    summary:
      input.decision === "APPROVED"
        ? `Approval granted for ${row.actionKey}`
        : `Approval rejected for ${row.actionKey}`,
    payload: { approvalId: row.id, decision: input.decision }
  });

  return { approvalId: row.id, decision: input.decision, correlationId: row.correlationId };
};

/**
 * Revalidate prerequisites after approval. Approving must not bypass missing
 * permission, expired credential, or open circuit.
 */
export const revalidateApprovedAction = async (input: {
  organizationId: string;
  approvalId: string;
  context: RemediationContext;
  automationMode?: string;
  circuitOpen?: boolean;
  credentialValid?: boolean;
  credentialReason?: string;
}): Promise<{ ok: true; approval: { id: string; correlationId: string; actionKey: string; approvedBy: string | null } } | { ok: false; reason: string }> => {
  const row = await prisma.remediationApproval.findFirst({
    where: { id: input.approvalId, organizationId: input.organizationId }
  });
  if (!row) return { ok: false, reason: "Approval not found" };
  if (row.decision === "PENDING" && row.expiresAt.getTime() <= Date.now()) {
    await prisma.remediationApproval.update({
      where: { id: row.id },
      data: {
        decision: "EXPIRED",
        decidedAt: new Date(),
        decisionReason: "Approval expired",
        updatedAt: new Date()
      }
    });
    return { ok: false, reason: "Approval expired" };
  }
  if (row.decision !== "APPROVED") {
    return { ok: false, reason: `Approval is ${row.decision}` };
  }
  if (input.circuitOpen) {
    return { ok: false, reason: "Circuit breaker is open — approval cannot bypass it" };
  }
  if (input.credentialValid === false) {
    return {
      ok: false,
      reason: input.credentialReason ?? "Credential missing, expired, or revoked"
    };
  }

  const availability = resolveActionAvailability({
    actionKey: row.actionKey,
    context: input.context,
    automationMode: input.automationMode ?? "APPROVAL",
    circuitOpen: input.circuitOpen,
    credentialValid: input.credentialValid,
    credentialReason: input.credentialReason,
    integrations: await loadProjectIntegrations({
      organizationId: input.organizationId,
      projectId: input.context.projectId
    })
  });
  if (
    !availability ||
    availability.state === "SETUP_REQUIRED" ||
    availability.state === "BLOCKED" ||
    availability.state === "NO_AUTOMATED_FIX" ||
    availability.state === "OBSERVE_ONLY"
  ) {
    return { ok: false, reason: availability?.reason ?? "Action no longer available" };
  }

  return {
    ok: true,
    approval: {
      id: row.id,
      correlationId: row.correlationId,
      actionKey: row.actionKey,
      approvedBy: row.decidedBy
    }
  };
};

export const expireStaleRemediationApprovals = async (organizationId?: string): Promise<number> => {
  const now = new Date();
  const result = await prisma.remediationApproval.updateMany({
    where: {
      decision: "PENDING",
      expiresAt: { lte: now },
      ...(organizationId ? { organizationId } : {})
    },
    data: {
      decision: "EXPIRED",
      decidedAt: now,
      decisionReason: "Approval expired",
      updatedAt: now
    }
  });
  return result.count;
};
