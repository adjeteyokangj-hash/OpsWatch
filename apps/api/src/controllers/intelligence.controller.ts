import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import { buildIntelligenceSnapshot } from "../services/intelligence/brain-snapshot.service";
import { prisma } from "../lib/prisma";
import { isPredictionsEnabled } from "../services/intelligence/intelligence-constants";
import { listFeatureGates } from "../services/intelligence/feature-gates.service";

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

export const getIntelligenceSnapshotHandler = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "diagnosis:read")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const harvest = req.query.harvest !== "false";
  const snapshot = await buildIntelligenceSnapshot(orgId, { harvest });
  res.json(snapshot);
};

export const getOperationsTimelineHandler = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "incidents:read")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const projectId =
    typeof req.query.projectId === "string" ? req.query.projectId : undefined;

  if (projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, organizationId: orgId },
      select: { id: true }
    });
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
  }

  const rows = await prisma.operationsTimelineEvent.findMany({
    where: {
      organizationId: orgId,
      ...(projectId ? { projectId } : {})
    },
    orderBy: { occurredAt: "desc" },
    take: limit
  });

  res.json({
    items: rows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      summary: row.summary,
      projectId: row.projectId,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      severity: row.severity,
      occurredAt: row.occurredAt.toISOString()
    }))
  });
};

export const getAutomationIntelligenceHistoryHandler = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "automation:plan:observe")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  const rows = await prisma.automationRun.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      Outcomes: { orderBy: { createdAt: "desc" }, take: 1 },
      Steps: { orderBy: { stepOrder: "asc" } }
    }
  });

  res.json({
    items: rows.map((row) => ({
      id: row.id,
      incidentId: row.incidentId,
      projectId: row.projectId,
      triggerType: row.triggerType,
      reason: row.reason,
      action: row.Steps[0]?.action ?? null,
      status: row.status,
      durationMs: row.durationMs,
      success: row.Outcomes[0]?.success ?? null,
      verificationStatus: row.verificationStatus,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      affectedServiceIds: row.affectedServiceIds,
      confidence: row.confidence,
      executionMode: row.executionMode,
      createdAt: row.createdAt.toISOString()
    }))
  });
};

export const getAiDecisionAuditHandler = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "analytics:view")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

  const rows = await prisma.aiDecisionAudit.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    take: limit
  });

  res.json({
    items: rows.map((row) => ({
      id: row.id,
      decisionType: row.decisionType,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      summary: row.summary,
      confidenceScore: row.confidenceScore,
      outcome: row.outcome,
      createdAt: row.createdAt.toISOString()
    }))
  });
};

export const getPredictionStatusHandler = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "diagnosis:read")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json({
    enabled: isPredictionsEnabled(),
    productEmission: false,
    message: isPredictionsEnabled()
      ? "Predictions flag is on, but product emission still requires confidence thresholds."
      : "Predictions are disabled. Framework tables exist for future use; no predictive claims are shown.",
    flag: "OPSWATCH_PREDICTIONS_ENABLED",
    gates: listFeatureGates()
  });
};

export const getFeatureGatesHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "diagnosis:read")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const gates = listFeatureGates();
  const { listLearningStages } = await import("../services/learning/learning-flags");
  res.json({
    gates,
    learningStages: listLearningStages(),
    defaultsOff: gates.every((gate) => gate.defaultEnabled === false),
    anyEnabled: gates.some((gate) => gate.enabled)
  });
};

export const reviewPredictionHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "remediation:approve")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const predictionId = typeof req.params.predictionId === "string" ? req.params.predictionId : "";
  const action = typeof req.body?.action === "string" ? req.body.action : "";
  const note = typeof req.body?.note === "string" ? req.body.note : undefined;
  const confidenceOverride =
    typeof req.body?.confidenceOverride === "number" ? req.body.confidenceOverride : undefined;
  const actorUserId = req.user?.id ?? "unknown";

  const { reviewPredictionCandidate } = await import(
    "../services/learning/prediction-review.service"
  );
  const result = await reviewPredictionCandidate({
    organizationId: orgId,
    predictionId,
    action: action as
      | "confirm"
      | "dismiss"
      | "mark_materialised"
      | "mark_prevented"
      | "mark_false_positive"
      | "expire",
    actorUserId,
    note,
    confidenceOverride
  });

  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result);
};
