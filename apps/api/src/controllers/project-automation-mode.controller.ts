import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import {
  resolveProjectAutonomousModeState,
  updateProjectAutonomousMode
} from "../services/automation/project-autonomous-mode.service";
import { normalizeProjectAutonomousMode, PROJECT_AUTONOMOUS_MODES } from "@opswatch/shared";

const requireOrg = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

export const getProjectAutonomousMode = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;

  const state = await resolveProjectAutonomousModeState({
    organizationId: orgId,
    projectId: String(req.params.projectId)
  });
  if (!state) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(state);
};

export const patchProjectAutonomousMode = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = requireOrg(req, res);
  if (!orgId) return;

  const role = req.user?.role;
  const modeRaw = req.body?.mode;
  if (typeof modeRaw !== "string" || !modeRaw.trim()) {
    res.status(400).json({ error: "mode is required" });
    return;
  }

  const normalized = normalizeProjectAutonomousMode(modeRaw);
  if (!(PROJECT_AUTONOMOUS_MODES as readonly string[]).includes(normalized)) {
    res.status(400).json({ error: "Invalid autonomous mode" });
    return;
  }

  const needsPolicyManage =
    normalized === "FULL_AUTONOMOUS" || normalized === "AUTO_HEAL_SAFE" || normalized === "DISABLED";
  if (needsPolicyManage && !hasPermission(role, "policy:manage")) {
    res.status(403).json({
      error: "policy:manage permission is required to set this autonomous mode"
    });
    return;
  }
  if (!hasPermission(role, "automation:plan:approve") && !hasPermission(role, "policy:manage")) {
    res.status(403).json({ error: "Insufficient permissions to change autonomous mode" });
    return;
  }

  const state = await updateProjectAutonomousMode({
    organizationId: orgId,
    projectId: String(req.params.projectId),
    mode: normalized,
    updatedById: typeof req.user?.sub === "string" ? req.user.sub : undefined
  });
  if (!state) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json(state);
};
