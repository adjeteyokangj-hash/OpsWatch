import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import { prisma } from "../lib/prisma";
import {
  assessAiLedReadiness,
  enableAiLedSafeOperations,
  rollbackPolicyRevision,
  setEmergencyStop,
  setOrganizationCeiling,
  simulateAiOperations
} from "../services/policy/enable-ai-led.service";
import { buildEffectivePolicySnapshot } from "../services/policy/effective-policy-snapshot.service";
import {
  defaultAiAutomationPolicyDocument,
  type AiAutomationPolicyDocument
} from "../services/policy/policy-document";

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

const requireAdmin = (req: AuthRequest, res: Response): boolean => {
  if (!hasPermission(req.user?.role, "automation:plan:approve")) {
    res.status(403).json({ error: "Forbidden — organisation admin or automation approver required" });
    return false;
  }
  return true;
};

export const getAiAutomationPoliciesHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "automation:plan:observe")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const projectId =
    typeof req.query.projectId === "string" && req.query.projectId.trim()
      ? req.query.projectId.trim()
      : undefined;

  const [snapshot, bundle, revisions, audits] = await Promise.all([
    buildEffectivePolicySnapshot({ organizationId: orgId, projectId }),
    prisma.aiAutomationPolicyBundle.findUnique({ where: { organizationId: orgId } }),
    prisma.aiAutomationPolicyRevision.findMany({
      where: { organizationId: orgId },
      orderBy: { version: "desc" },
      take: 20
    }),
    prisma.aiPolicyAuditEvent.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      take: 50
    })
  ]);

  res.json({
    snapshot,
    bundle: bundle
      ? {
          id: bundle.id,
          operatingProfile: bundle.operatingProfile,
          status: bundle.status,
          document: bundle.documentJson,
          ownerUserId: bundle.ownerUserId,
          approverUserId: bundle.approverUserId,
          activatedAt: bundle.activatedAt?.toISOString() ?? null,
          updatedAt: bundle.updatedAt.toISOString()
        }
      : {
          id: null,
          operatingProfile: "MONITOR_ONLY",
          status: "DRAFT",
          document: defaultAiAutomationPolicyDocument("MONITOR_ONLY"),
          ownerUserId: null,
          approverUserId: null,
          activatedAt: null,
          updatedAt: null
        },
    revisions: revisions.map((row) => ({
      id: row.id,
      version: row.version,
      status: row.status,
      reason: row.reason,
      actorUserId: row.actorUserId,
      activatedAt: row.activatedAt.toISOString()
    })),
    audits: audits.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      summary: row.summary,
      actorUserId: row.actorUserId,
      createdAt: row.createdAt.toISOString(),
      detail: row.detailJson
    }))
  });
};

export const enableAiLedHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId || !requireAdmin(req, res)) return;

  const projectIds = Array.isArray(req.body?.projectIds)
    ? req.body.projectIds.filter((id: unknown) => typeof id === "string")
    : undefined;

  try {
    const result = await enableAiLedSafeOperations({
      organizationId: orgId,
      actorUserId: req.user?.id ?? "unknown",
      projectIds
    });
    const snapshot = await buildEffectivePolicySnapshot({ organizationId: orgId });
    res.json({ ...result, snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enable AI-led failed";
    res.status(500).json({ error: message });
  }
};

export const patchOrganizationCeilingHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId || !requireAdmin(req, res)) return;

  const executionMode = typeof req.body?.executionMode === "string" ? req.body.executionMode : "";
  if (!executionMode) {
    res.status(400).json({ error: "executionMode is required" });
    return;
  }

  try {
    const result = await setOrganizationCeiling({
      organizationId: orgId,
      executionMode,
      actorUserId: req.user?.id ?? "unknown",
      reason: typeof req.body?.reason === "string" ? req.body.reason : undefined
    });
    const snapshot = await buildEffectivePolicySnapshot({ organizationId: orgId });
    res.json({ ...result, snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Update failed";
    res.status(400).json({ error: message });
  }
};

export const patchEmergencyStopHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId || !requireAdmin(req, res)) return;

  const projectId = typeof req.body?.projectId === "string" ? req.body.projectId : "";
  const disabled = Boolean(req.body?.disabled);
  if (!projectId) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }

  try {
    const result = await setEmergencyStop({
      organizationId: orgId,
      projectId,
      disabled,
      actorUserId: req.user?.id ?? "unknown",
      reason: typeof req.body?.reason === "string" ? req.body.reason : undefined
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Emergency stop update failed";
    res.status(400).json({ error: message });
  }
};

export const rollbackPolicyHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId || !requireAdmin(req, res)) return;

  const revisionId = typeof req.body?.revisionId === "string" ? req.body.revisionId : "";
  if (!revisionId) {
    res.status(400).json({ error: "revisionId is required" });
    return;
  }

  try {
    const result = await rollbackPolicyRevision({
      organizationId: orgId,
      revisionId,
      actorUserId: req.user?.id ?? "unknown"
    });
    const snapshot = await buildEffectivePolicySnapshot({ organizationId: orgId });
    res.json({ ...result, snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rollback failed";
    res.status(400).json({ error: message });
  }
};

export const simulateAiOperationsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "automation:plan:observe")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const projectId =
    typeof req.query.projectId === "string" && req.query.projectId.trim()
      ? req.query.projectId.trim()
      : typeof req.body?.projectId === "string"
        ? req.body.projectId
        : undefined;

  const result = await simulateAiOperations({ organizationId: orgId, projectId });
  res.json(result);
};

export const getAiLedReadinessHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "automation:plan:observe")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(await assessAiLedReadiness(orgId));
};

export const patchAiAutomationDocumentHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId || !requireAdmin(req, res)) return;

  const document = req.body?.document as AiAutomationPolicyDocument | undefined;
  if (!document || document.version !== 1 || !document.areas) {
    res.status(400).json({ error: "document with version 1 and areas is required" });
    return;
  }

  const existing = await prisma.aiAutomationPolicyBundle.findUnique({ where: { organizationId: orgId } });
  const now = new Date();
  const { randomUUID } = await import("crypto");

  if (!existing) {
    await prisma.aiAutomationPolicyBundle.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        operatingProfile: String(document.areas.operatingProfile.profile ?? "MONITOR_ONLY"),
        status: "DRAFT",
        documentJson: document as unknown as object,
        ownerUserId: req.user?.id,
        updatedAt: now
      }
    });
  } else {
    const last = await prisma.aiAutomationPolicyRevision.findFirst({
      where: { bundleId: existing.id },
      orderBy: { version: "desc" }
    });
    await prisma.$transaction([
      prisma.aiAutomationPolicyBundle.update({
        where: { id: existing.id },
        data: {
          documentJson: document as unknown as object,
          operatingProfile: String(document.areas.operatingProfile.profile ?? existing.operatingProfile),
          updatedAt: now
        }
      }),
      prisma.aiAutomationPolicyRevision.create({
        data: {
          id: randomUUID(),
          organizationId: orgId,
          bundleId: existing.id,
          version: (last?.version ?? 0) + 1,
          status: "ACTIVE",
          beforeJson: existing.documentJson as object,
          afterJson: document as object,
          reason: "Document patch",
          actorUserId: req.user?.id ?? "unknown"
        }
      }),
      prisma.aiPolicyAuditEvent.create({
        data: {
          id: randomUUID(),
          organizationId: orgId,
          bundleId: existing.id,
          eventType: "policy_changed",
          summary: "AI automation policy document updated",
          actorUserId: req.user?.id ?? "unknown",
          detailJson: { profile: document.areas.operatingProfile.profile }
        }
      })
    ]);
  }

  res.json({
    ok: true,
    snapshot: await buildEffectivePolicySnapshot({ organizationId: orgId })
  });
};
