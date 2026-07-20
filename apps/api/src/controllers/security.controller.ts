import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import {
  ingestSecurityEvents,
  type SecurityEventIngestInput
} from "../services/security/security-ingest.service";
import { eventFamily } from "../services/security/security-event-types";
import { SECURITY_WRITE_SCOPES } from "../services/security/security-scopes";
import { computeSecurityCoverage } from "../services/security/security-coverage.service";
import { listSecurityFindings } from "../services/security/security-findings.service";

const orgIdFromApiKey = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.apiKeyOrganizationId || req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
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

  // Soft family check: authentication.events:write alone should not write business events.
  const allowedFamilies = familiesFromScopes(scopes);
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
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }
  if (!hasPermission(req.user?.role, "security:read")) {
    res.status(403).json({ error: "Missing security:read permission" });
    return;
  }

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

export const getSecurityCoverageController = async (req: AuthRequest, res: Response) => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) {
    res.status(403).json({ error: "Organization required" });
    return;
  }
  if (!hasPermission(req.user?.role, "security:read")) {
    res.status(403).json({ error: "Organization security coverage requires security:read" });
    return;
  }
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const coverage = await computeSecurityCoverage({ organizationId, projectId });
  res.json(coverage);
};
