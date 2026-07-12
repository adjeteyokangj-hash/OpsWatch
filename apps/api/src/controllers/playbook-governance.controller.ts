import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import { canApproveGlobalPlaybookCatalog } from "../services/automation/platform-playbook-governance";
import {
  createPlaybookDraftVersion,
  deprecatePlaybookVersion,
  listPlaybooksWithGovernance,
  reviewPlaybookVersion,
  submitPlaybookVersionForReview
} from "../services/automation/playbook-governance.service";

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

export const listGovernedPlaybooksHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "playbooks:view")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(await listPlaybooksWithGovernance());
};

export const createPlaybookDraftHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "playbooks:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = req.body ?? {};
  if (!body.playbookKey || !Array.isArray(body.steps)) {
    res.status(400).json({ error: "playbookKey and steps are required" });
    return;
  }

  try {
    const created = await createPlaybookDraftVersion({
      playbookKey: body.playbookKey,
      steps: body.steps,
      createdById: typeof req.user?.sub === "string" ? req.user.sub : "operator"
    });
    res.status(201).json(created);
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Unable to create draft version" });
  }
};

export const submitPlaybookVersionHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "playbooks:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const version = Number(req.params.version);
  if (!Number.isFinite(version)) {
    res.status(400).json({ error: "Invalid version" });
    return;
  }

  try {
    const updated = await submitPlaybookVersionForReview({
      playbookKey: String(req.params.playbookKey),
      version,
      submittedById: typeof req.user?.sub === "string" ? req.user.sub : "operator"
    });
    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Unable to submit version" });
  }
};

export const reviewPlaybookVersionHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "playbooks:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const version = Number(req.params.version);
  const decision = req.body?.decision;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!Number.isFinite(version) || (decision !== "APPROVED" && decision !== "REJECTED")) {
    res.status(400).json({ error: "Valid version and decision are required" });
    return;
  }
  if (!reason) {
    res.status(400).json({ error: "reason is required" });
    return;
  }

  if (decision === "APPROVED" && !canApproveGlobalPlaybookCatalog(req.user?.email)) {
    res.status(403).json({
      error: "Global playbook approval is restricted to platform approvers configured in PLATFORM_PLAYBOOK_APPROVER_EMAILS"
    });
    return;
  }

  try {
    const updated = await reviewPlaybookVersion({
      playbookKey: String(req.params.playbookKey),
      version,
      decision,
      reviewedById: typeof req.user?.sub === "string" ? req.user.sub : "operator",
      reason
    });
    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Unable to review version" });
  }
};

export const deprecatePlaybookVersionHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "playbooks:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const version = Number(req.params.version);
  if (!Number.isFinite(version)) {
    res.status(400).json({ error: "Invalid version" });
    return;
  }

  try {
    const updated = await deprecatePlaybookVersion({
      playbookKey: String(req.params.playbookKey),
      version
    });
    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Unable to deprecate version" });
  }
};
