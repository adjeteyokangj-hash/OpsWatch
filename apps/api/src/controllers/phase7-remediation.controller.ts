import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import { listUniversalActions, getUniversalAction } from "../services/remediation/action-registry";
import { listAvailableActionsForContext } from "../services/remediation/availability.service";
import {
  decideRemediationApproval,
  requestRemediationApproval
} from "../services/remediation/approval.service";
import {
  executeGovernedRemediation,
  recoverStaleRunningRemediationRuns
} from "../services/remediation/execution-run.service";
import {
  resetCircuitBreaker,
  tripCircuitBreaker
} from "../services/remediation/circuit-breaker.service";
import { applyVerifiedRecoveryResolution } from "../services/remediation/recovery-resolution.service";
import { ensureRemediationProvidersRegistered } from "../services/remediation/providers/register-providers";
import { prisma } from "../lib/prisma";
import { redactUnknown } from "../lib/redact-secrets";

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

export const listRemediationActions = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  ensureRemediationProvidersRegistered();
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const automationMode =
    typeof req.query.automationMode === "string" ? req.query.automationMode : "APPROVAL";
  const connectionId =
    typeof req.query.connectionId === "string" ? req.query.connectionId : undefined;

  const available = listAvailableActionsForContext({
    context: {
      organizationId: orgId,
      projectId,
      integrationId: connectionId,
      extra: connectionId ? { connectionId } : {}
    },
    automationMode
  });

  res.json({
    registry: listUniversalActions().map((row) => ({
      actionKey: row.actionKey,
      displayName: row.displayName,
      riskLevel: row.riskLevel,
      providerType: row.providerType,
      requiresApproval: row.requiresApproval,
      verificationStrategy: row.verificationStrategy,
      rollbackCapability: row.rollbackCapability
    })),
    available
  });
};

export const requestPhase7Approval = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "remediation:execute:safe")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const body = req.body ?? {};
  const actionKey = String(body.actionKey || "");
  if (!actionKey) {
    res.status(400).json({ error: "actionKey is required" });
    return;
  }
  try {
    const result = await requestRemediationApproval({
      context: {
        organizationId: orgId,
        projectId: body.projectId,
        alertId: body.alertId,
        incidentId: body.incidentId,
        serviceId: body.serviceId,
        integrationId: body.connectionId,
        extra: {
          connectionId: body.connectionId,
          entityId: body.entityId,
          relationshipId: body.relationshipId
        }
      },
      actionKey,
      reason: String(body.reason || "Operator requested remediation approval"),
      requestedBy: typeof req.user?.sub === "string" ? req.user.sub : undefined,
      evidence: typeof body.evidence === "object" && body.evidence ? body.evidence : {},
      automationMode: body.automationMode || "APPROVAL"
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Approval failed" });
  }
};

export const decidePhase7Approval = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "remediation:approve")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const decision = String(req.body?.decision || "").toUpperCase();
  if (decision !== "APPROVED" && decision !== "REJECTED") {
    res.status(400).json({ error: "decision must be APPROVED or REJECTED" });
    return;
  }
  try {
    const approvalId = String(req.params.approvalId || "");
    if (!approvalId) {
      res.status(400).json({ error: "approvalId is required" });
      return;
    }
    const decidedBy = typeof req.user?.sub === "string" ? req.user.sub : "";
    if (!decidedBy) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const result = await decideRemediationApproval({
      organizationId: orgId,
      approvalId,
      decision: decision as "APPROVED" | "REJECTED",
      decidedBy,
      decisionReason: String(req.body?.reason || decision)
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Decision failed" });
  }
};

export const executePhase7Governed = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  const body = req.body ?? {};
  const actionKey = String(body.actionKey || "");
  const automationMode = String(body.automationMode || "APPROVAL").toUpperCase();
  if (!actionKey) {
    res.status(400).json({ error: "actionKey is required" });
    return;
  }
  if (automationMode !== "APPROVAL" && automationMode !== "AUTONOMOUS") {
    res.status(400).json({ error: "automationMode must be APPROVAL or AUTONOMOUS" });
    return;
  }

  const def = getUniversalAction(actionKey);
  if (!def) {
    res.status(400).json({ error: "Unknown action" });
    return;
  }
  if (!hasPermission(req.user?.role, "remediation:execute:safe")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const outcome = await executeGovernedRemediation({
      context: {
        organizationId: orgId,
        projectId: body.projectId,
        alertId: body.alertId,
        incidentId: body.incidentId,
        serviceId: body.serviceId,
        integrationId: body.connectionId,
        note: body.note,
        extra: {
          connectionId: body.connectionId,
          entityId: body.entityId,
          relationshipId: body.relationshipId,
          ...(typeof body.extra === "object" && body.extra ? body.extra : {})
        }
      },
      actionKey,
      automationMode: automationMode as "APPROVAL" | "AUTONOMOUS",
      requestedBy: typeof req.user?.sub === "string" ? req.user.sub : undefined,
      approvalId: typeof body.approvalId === "string" ? body.approvalId : undefined,
      idempotencyKey:
        typeof body.idempotencyKey === "string"
          ? body.idempotencyKey
          : req.header("Idempotency-Key")?.trim(),
      forceRollbackOnVerificationFailure: body.forceRollback !== false
    });

    if (
      outcome.verification?.state === "VERIFIED_HEALTHY" ||
      outcome.run.status === "VERIFIED_HEALTHY"
    ) {
      await applyVerifiedRecoveryResolution({
        organizationId: orgId,
        projectId: body.projectId,
        alertId: body.alertId,
        incidentId: body.incidentId,
        correlationId: outcome.run.correlationId,
        recoveryCause:
          automationMode === "AUTONOMOUS" ? "automatic" : "administrator-approved",
        verificationState: "VERIFIED_HEALTHY",
        actorUserId: typeof req.user?.sub === "string" ? req.user.sub : null
      });
    } else if (outcome.verification?.state === "VERIFICATION_FAILED") {
      await applyVerifiedRecoveryResolution({
        organizationId: orgId,
        projectId: body.projectId,
        alertId: body.alertId,
        incidentId: body.incidentId,
        correlationId: outcome.run.correlationId,
        recoveryCause:
          automationMode === "AUTONOMOUS" ? "automatic" : "administrator-approved",
        verificationState: "VERIFICATION_FAILED",
        actorUserId: typeof req.user?.sub === "string" ? req.user.sub : null
      });
    }

    res.json({
      run: redactUnknown(outcome.run),
      providerResult: redactUnknown(outcome.providerResult),
      verification: outcome.verification ? redactUnknown(outcome.verification) : null,
      rollback: outcome.rollback ? redactUnknown(outcome.rollback) : null
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Execution failed" });
  }
};

export const listPhase7Runs = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const where: Record<string, unknown> = { organizationId: orgId };
  if (typeof req.query.projectId === "string") where.projectId = req.query.projectId;
  if (typeof req.query.incidentId === "string") where.incidentId = req.query.incidentId;
  if (typeof req.query.alertId === "string") where.alertId = req.query.alertId;
  if (typeof req.query.status === "string") where.status = req.query.status;
  if (typeof req.query.actionKey === "string") where.actionKey = req.query.actionKey;
  if (typeof req.query.provider === "string") where.provider = req.query.provider;
  if (typeof req.query.riskLevel === "string") where.riskLevel = req.query.riskLevel;
  if (typeof req.query.automationMode === "string") where.automationMode = req.query.automationMode;
  if (typeof req.query.requestedBy === "string") where.requestedBy = req.query.requestedBy;
  if (typeof req.query.environment === "string") where.environment = req.query.environment;

  const take = Math.min(Number(req.query.limit || 50), 200);
  const [runs, approvals] = await Promise.all([
    prisma.remediationExecutionRun.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take
    }),
    prisma.remediationApproval.findMany({
      where: { organizationId: orgId, decision: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ]);

  res.json({
    runs: runs.map((row) => redactUnknown(row)),
    pendingApprovals: approvals.map((row) => redactUnknown(row))
  });
};

export const tripPhase7Circuit = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "policy:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const row = await tripCircuitBreaker({
    organizationId: orgId,
    projectId: req.body?.projectId,
    actionKey: String(req.body?.actionKey || ""),
    trippedBy: typeof req.user?.sub === "string" ? req.user.sub : "admin",
    reason: String(req.body?.reason || "Manual trip")
  });
  res.json(redactUnknown(row));
};

export const resetPhase7Circuit = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "policy:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const row = await resetCircuitBreaker({
    organizationId: orgId,
    projectId: req.body?.projectId,
    actionKey: String(req.body?.actionKey || ""),
    resetBy: typeof req.user?.sub === "string" ? req.user.sub : "admin"
  });
  res.json(redactUnknown(row));
};

export const recoverPhase7StaleRuns = async (req: AuthRequest, res: Response) => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "policy:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const count = await recoverStaleRunningRemediationRuns();
  res.json({ recovered: count });
};
