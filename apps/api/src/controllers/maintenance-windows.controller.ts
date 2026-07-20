import { Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import {
  cancelMaintenanceWindow,
  createMaintenanceWindow,
  getMaintenanceWindow,
  listMaintenanceWindows,
  updateMaintenanceWindow
} from "../services/maintenance-windows.service";
import { listActiveMaintenanceWindows } from "../services/maintenance-window-policy.service";

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

export const listMaintenanceWindowsHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "maintenance:view")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.json(await listMaintenanceWindows(orgId));
};

export const getMaintenanceWindowHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "maintenance:view")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const row = await getMaintenanceWindow(orgId, String(req.params.id));
  if (!row) {
    res.status(404).json({ error: "Maintenance window not found" });
    return;
  }
  res.json(row);
};

export const createMaintenanceWindowHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "maintenance:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = req.body ?? {};
  const startsAt = body.startsAt ? new Date(body.startsAt) : null;
  const endsAt = body.endsAt ? new Date(body.endsAt) : null;
  if (!body.name || !startsAt || !endsAt || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    res.status(400).json({ error: "name, startsAt, and endsAt are required" });
    return;
  }

  try {
    const created = await createMaintenanceWindow({
      organizationId: orgId,
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      name: body.name,
      description: typeof body.description === "string" ? body.description : null,
      startsAt,
      endsAt,
      suppressAlerts: body.suppressAlerts !== false,
      suppressIncidents: Boolean(body.suppressIncidents),
      allowAutonomous: Boolean(body.allowAutonomous),
      remediationPolicy:
        body.remediationPolicy === undefined ? undefined : body.remediationPolicy,
      serviceIds: Array.isArray(body.serviceIds) ? body.serviceIds : [],
      createdById: typeof req.user?.sub === "string" ? req.user.sub : "operator"
    });
    res.status(201).json(created);
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Unable to create maintenance window" });
  }
};

export const updateMaintenanceWindowHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "maintenance:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const body = req.body ?? {};
  try {
    const updated = await updateMaintenanceWindow({
      organizationId: orgId,
      id: String(req.params.id),
      name: typeof body.name === "string" ? body.name : undefined,
      description: body.description === null || typeof body.description === "string" ? body.description : undefined,
      startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
      endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
      suppressAlerts: typeof body.suppressAlerts === "boolean" ? body.suppressAlerts : undefined,
      suppressIncidents: typeof body.suppressIncidents === "boolean" ? body.suppressIncidents : undefined,
      allowAutonomous: typeof body.allowAutonomous === "boolean" ? body.allowAutonomous : undefined,
      remediationPolicy:
        body.remediationPolicy === undefined ? undefined : body.remediationPolicy,
      serviceIds: Array.isArray(body.serviceIds) ? body.serviceIds : undefined
    });
    res.json(updated);
  } catch (error: any) {
    const message = error?.message ?? "Unable to update maintenance window";
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
};

export const cancelMaintenanceWindowHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "maintenance:manage")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const cancelled = await cancelMaintenanceWindow({
      organizationId: orgId,
      id: String(req.params.id),
      cancelledById: typeof req.user?.sub === "string" ? req.user.sub : "operator"
    });
    res.json(cancelled);
  } catch (error: any) {
    const message = error?.message ?? "Unable to cancel maintenance window";
    res.status(message.includes("not found") ? 404 : 400).json({ error: message });
  }
};

export const listActiveMaintenanceHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "maintenance:view")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  const rows = await listActiveMaintenanceWindows({ organizationId: orgId, projectId });
  res.json(rows);
};
