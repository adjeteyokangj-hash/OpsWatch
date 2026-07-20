import { Response } from "express";
import { randomUUID } from "crypto";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import {
  ingestSecurityEvents,
  type SecurityEventIngestInput
} from "../services/security/security-ingest.service";
import { eventFamily } from "../services/security/security-event-types";
import { SECURITY_WRITE_SCOPES } from "../services/security/security-scopes";
import { computeSecurityCoverage } from "../services/security/security-coverage.service";
import {
  getSecurityFindingById,
  listSecurityFindings
} from "../services/security/security-findings.service";
import {
  acceptFindingRisk,
  markFindingFalsePositive,
  suppressFinding
} from "../services/security/security-findings-lifecycle.service";
import {
  buildAttackPathView,
  correlateThreatSequences
} from "../services/security/security-correlation.service";
import { getSecurityTopologyOverlay } from "../services/security/security-topology-overlay.service";
import {
  createSecurityResponseRun,
  type SecurityResponseActionKey
} from "../services/security/security-response.service";
import { ensureDefaultDetectionRules } from "../services/security/security-detection-rules";
import { prisma } from "../lib/prisma";
import { runExternalSurfaceCheck } from "../services/security/security-external-surface.service";

const orgIdFromApiKey = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.apiKeyOrganizationId || req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

const requireOrgAndPermission = (
  req: AuthRequest,
  res: Response,
  permission: Parameters<typeof hasPermission>[1]
): string | null => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  if (!hasPermission(req.user?.role, permission)) {
    res.status(403).json({ error: `Missing ${permission} permission` });
    return null;
  }
  return organizationId;
};

const familiesFromScopes = (scopes: string[] | undefined): string[] => {
  const set = new Set<string>();
  for (const scope of scopes || []) {
    if (scope === "security.events:write") set.add("security");
    if (scope === "authentication.events:write") {
      set.add("authentication");
      set.add("security");
    }
    if (scope === "audit.events:write") {
      set.add("audit");
      set.add("security");
    }
  }
  return Array.from(set);
};

const normalizeEventsBody = (body: unknown): SecurityEventIngestInput[] => {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  if (Array.isArray(record.events)) return record.events as SecurityEventIngestInput[];
  if (record.event && typeof record.event === "object") {
    return [record.event as SecurityEventIngestInput];
  }
  if (typeof record.eventType === "string") {
    return [record as SecurityEventIngestInput];
  }
  return [];
};

export const ingestSecurityEventsController = async (req: AuthRequest, res: Response) => {
  const organizationId = orgIdFromApiKey(req, res);
  if (!organizationId) return;

  const scopes = req.apiKeyScopes || [];
  const hasWrite = SECURITY_WRITE_SCOPES.some((scope) => scopes.includes(scope));
  if (!hasWrite && !req.user) {
    res.status(403).json({ error: "Missing security write scope" });
    return;
  }

  const events = normalizeEventsBody(req.body);
  if (events.length === 0) {
    res.status(400).json({ error: "No security events provided" });
    return;
  }

  if (scopes.includes("authentication.events:write") && !scopes.includes("security.events:write")) {
    for (const event of events) {
      if (eventFamily(event.eventType) !== "authentication") {
        res.status(403).json({
          error: "authentication.events:write only permits authentication event types"
        });
        return;
      }
    }
  }

  const allowedFamilies = familiesFromScopes(scopes);
  const result = await ingestSecurityEvents(events, {
    organizationId,
    environmentBinding: req.apiKeyEnvironment || null,
    providerSource: "api_key",
    rawSource: "POST /security/events",
    allowedEventFamilies: allowedFamilies.length > 0 ? allowedFamilies : null
  });

  const status = result.accepted > 0 && result.rejected > 0 ? 207 : result.accepted > 0 ? 202 : 400;
  res.status(status).json(result);
};

export const listSecurityFindingsController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:read");
  if (!organizationId) return;

  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const state = typeof req.query.state === "string" ? req.query.state : undefined;
  const severity = typeof req.query.severity === "string" ? req.query.severity : undefined;
  const findings = await listSecurityFindings({
    organizationId,
    projectId,
    state,
    severity,
    actorUserId: req.user?.id
  });
  res.json({ findings });
};

export const getSecurityFindingController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:investigate");
  if (!organizationId) return;
  const finding = await getSecurityFindingById({
    organizationId,
    findingId: String(req.params.id),
    actorUserId: req.user?.id
  });
  if (!finding) {
    res.status(404).json({ error: "Finding not found" });
    return;
  }
  res.json({ finding });
};

export const markFalsePositiveController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:manage_suppression");
  if (!organizationId) return;
  const reason = String(req.body?.reason || "").trim();
  if (!reason) {
    res.status(400).json({ error: "reason required" });
    return;
  }
  const finding = await markFindingFalsePositive({
    organizationId,
    findingId: String(req.params.id),
    actorUserId: req.user?.id,
    reason
  });
  if (!finding) {
    res.status(404).json({ error: "Finding not found" });
    return;
  }
  res.json({ finding });
};

export const acceptRiskController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:manage_suppression");
  if (!organizationId) return;
  const reason = String(req.body?.reason || "").trim();
  if (!reason) {
    res.status(400).json({ error: "reason required" });
    return;
  }
  const until = req.body?.until ? new Date(String(req.body.until)) : null;
  const finding = await acceptFindingRisk({
    organizationId,
    findingId: String(req.params.id),
    actorUserId: req.user?.id,
    reason,
    until
  });
  if (!finding) {
    res.status(404).json({ error: "Finding not found" });
    return;
  }
  res.json({ finding });
};

export const suppressFindingController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:manage_suppression");
  if (!organizationId) return;
  const reason = String(req.body?.reason || "").trim();
  const until = req.body?.until ? new Date(String(req.body.until)) : null;
  if (!reason || !until || Number.isNaN(until.getTime())) {
    res.status(400).json({ error: "reason and until required" });
    return;
  }
  const finding = await suppressFinding({
    organizationId,
    findingId: String(req.params.id),
    actorUserId: req.user?.id,
    reason,
    until
  });
  if (!finding) {
    res.status(404).json({ error: "Finding not found" });
    return;
  }
  res.json({ finding });
};

export const getSecurityCoverageController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:read");
  if (!organizationId) return;
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const coverage = await computeSecurityCoverage({ organizationId, projectId });
  res.json(coverage);
};

export const listSequencesController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:read");
  if (!organizationId) return;
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (req.query.refresh === "true") {
    await correlateThreatSequences({ organizationId, projectId });
  }
  const sequences = await prisma.threatCorrelationSequence.findMany({
    where: {
      organizationId,
      ...(projectId ? { projectId } : {})
    },
    orderBy: { lastSeenAt: "desc" },
    take: 100
  });
  res.json({ sequences });
};

export const getSequenceController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:investigate");
  if (!organizationId) return;
  const attackPath = await buildAttackPathView({
    organizationId,
    sequenceId: String(req.params.id)
  });
  if (!attackPath) {
    res.status(404).json({ error: "Sequence not found" });
    return;
  }
  res.json(attackPath);
};

export const getTopologyOverlayController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:read");
  if (!organizationId) return;
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const overlay = await getSecurityTopologyOverlay({ organizationId, projectId });
  res.json(overlay);
};

export const listRulesController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:read");
  if (!organizationId) return;
  await ensureDefaultDetectionRules(organizationId);
  const rules = await prisma.securityDetectionRule.findMany({
    where: { organizationId },
    orderBy: [{ category: "asc" }, { ruleKey: "asc" }]
  });
  res.json({ rules });
};

export const updateRuleController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:manage_rules");
  if (!organizationId) return;
  const rule = await prisma.securityDetectionRule.findFirst({
    where: { id: String(req.params.id), organizationId }
  });
  if (!rule) {
    res.status(404).json({ error: "Rule not found" });
    return;
  }
  const before = { ...rule };
  const updated = await prisma.securityDetectionRule.update({
    where: { id: rule.id },
    data: {
      enabled: typeof req.body?.enabled === "boolean" ? req.body.enabled : rule.enabled,
      severity: typeof req.body?.severity === "string" ? req.body.severity : rule.severity,
      windowMs: typeof req.body?.windowMs === "number" ? req.body.windowMs : rule.windowMs,
      minimumSamples:
        typeof req.body?.minimumSamples === "number" ? req.body.minimumSamples : rule.minimumSamples,
      thresholdJson: req.body?.thresholdJson ?? rule.thresholdJson,
      version: rule.version + 1,
      lastChangedBy: req.user?.id || null,
      updatedAt: new Date()
    }
  });
  await prisma.securityRuleAudit.create({
    data: {
      id: randomUUID(),
      organizationId,
      ruleId: rule.id,
      actorUserId: req.user?.id,
      action: "UPDATE",
      beforeJson: before,
      afterJson: updated
    }
  });
  res.json({ rule: updated });
};

export const securityResponseController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:respond");
  if (!organizationId) return;
  const actionKey = String(req.body?.actionKey || "") as SecurityResponseActionKey;
  const automationMode = (req.body?.automationMode || "OBSERVE") as "OBSERVE" | "APPROVAL" | "AUTONOMOUS";
  if (automationMode === "APPROVAL" && !hasPermission(req.user?.role, "security:approve_high_risk")) {
    // Approval still allowed for medium via security:respond; high-risk gated separately in service.
  }
  const result = await createSecurityResponseRun({
    organizationId,
    projectId: req.body?.projectId,
    findingId: req.body?.findingId,
    incidentId: req.body?.incidentId,
    sequenceId: req.body?.sequenceId,
    actionKey,
    automationMode,
    requestedBy: req.user?.id,
    context: req.body?.context || {}
  });
  res.status(result.status === "SETUP_REQUIRED" ? 400 : 200).json(result);
};

export const externalSurfaceCheckController = async (req: AuthRequest, res: Response) => {
  const organizationId = requireOrgAndPermission(req, res, "security:respond");
  if (!organizationId) return;
  const targetUrl = String(req.body?.targetUrl || "").trim();
  if (!targetUrl) {
    res.status(400).json({ error: "targetUrl required" });
    return;
  }
  const result = await runExternalSurfaceCheck({
    organizationId,
    projectId: req.body?.projectId,
    environment: req.body?.environment,
    entityId: req.body?.entityId,
    targetUrl,
    mode: req.body?.mode === "PASSIVE" ? "PASSIVE" : "SAFE_VALIDATION",
    previousFingerprint: req.body?.previousFingerprint,
    previousHeaders: req.body?.previousHeaders
  });
  res.status(result.ok ? 200 : 400).json(result);
};
